package com.rnmapbox.rnmbx.utils

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.util.DisplayMetrics
import android.util.Log
import com.facebook.common.references.CloseableReference
import com.facebook.common.util.UriUtil
import com.facebook.datasource.DataSources
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.common.RotationOptions
import com.facebook.imagepipeline.image.CloseableImage
import com.facebook.imagepipeline.image.CloseableStaticBitmap
import com.facebook.imagepipeline.request.ImageRequestBuilder
import com.mapbox.maps.MapboxMap
import com.rnmapbox.rnmbx.components.images.ImageInfo
import com.rnmapbox.rnmbx.components.images.ImageManager
import com.rnmapbox.rnmbx.v11compat.image.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import pl.droidsonroids.gif.GifDrawable
import java.io.File
import java.io.InputStream
import java.lang.ref.WeakReference
import java.net.URLDecoder

data class DownloadedImage(
    val name: String,
    val bitmap: Bitmap,
    val info: ImageInfo,
)

class DownloadMapImageTask(
    context: Context,
    map: MapboxMap,
    imageManager: ImageManager?,
    callback: OnAllImagesLoaded? = null,
) {
    private val mMap: WeakReference<MapboxMap> = WeakReference(map)
    private val mCallback: OnAllImagesLoaded? = callback
    private val mImageManager: WeakReference<ImageManager> = WeakReference(imageManager)
    private val contextRef = WeakReference(context.applicationContext)

    interface OnAllImagesLoaded {
        fun onAllImagesLoaded()
    }

    fun execute(entries: Array<Map.Entry<String, ImageEntry>>) {
        val context = contextRef.get() ?: return
        CoroutineScope(Dispatchers.Main).launch {
            val images =
                withContext(Dispatchers.IO) {
                    downloadImages(entries, context)
                }

            mCallback?.onAllImagesLoaded()
        }
    }

    private suspend fun downloadImages(
        entries: Array<Map.Entry<String, ImageEntry>>,
        context: Context,
    ): List<DownloadedImage> =
        coroutineScope {
            entries
                .asFlow()
                .flatMapMerge(concurrency = entries.size) { entry ->
                    flow { emit(downloadImage(entry.key, entry.value, context)) }
                }.filterNotNull()
                .toList()
        }

    private fun downloadImage(
        key: String,
        imageEntry: ImageEntry,
        context: Context,
    ): DownloadedImage? {
        var uri = imageEntry.uri
        val originalUri = uri

        if (uri.startsWith("/")) {
            uri = Uri.fromFile(File(uri)).toString()
        } else if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
            var resourceId = context.resources.getIdentifier(uri, "drawable", context.applicationContext.packageName)
            if (resourceId > 0) {
                uri = UriUtil.getUriForResourceId(resourceId).toString()
            } else {
                Log.e(LOG_TAG, "Failed to find resource for image: $key ${imageEntry.info.name} ${imageEntry.uri}")
            }
        }

        // Check if this is a GIF by examining both the original URI and the resolved URI
        // Decode URLs to handle encoded characters like %2E for .
        val decodedOriginalUri =
            try {
                URLDecoder.decode(originalUri, "UTF-8")
            } catch (e: Exception) {
                originalUri
            }
        val decodedUri =
            try {
                URLDecoder.decode(uri, "UTF-8")
            } catch (e: Exception) {
                uri
            }

        val isGif =
            decodedOriginalUri.lowercase().endsWith(".gif") ||
                decodedUri.lowercase().endsWith(".gif") ||
                decodedOriginalUri.lowercase().contains(".gif") ||
                decodedUri.lowercase().contains(".gif") ||
                key.lowercase().contains("gif")

        if (isGif) {
            return downloadGifImage(key, uri, imageEntry, context)
        } else {
            return downloadStaticImage(key, uri, imageEntry, context)
        }
    }

    private fun downloadStaticImage(
        key: String,
        uri: String,
        imageEntry: ImageEntry,
        context: Context,
    ): DownloadedImage? {
        val request =
            ImageRequestBuilder
                .newBuilderWithSource(Uri.parse(uri))
                .setRotationOptions(RotationOptions.autoRotate())
                .build()
        val dataSource = Fresco.getImagePipeline().fetchDecodedImage(request, this)
        var result: CloseableReference<CloseableImage>? = null
        return try {
            result = DataSources.waitForFinalResult(dataSource)
            result?.get()?.let { image ->
                if (image is CloseableStaticBitmap) {
                    val bitmap = image.underlyingBitmap.copy(Bitmap.Config.ARGB_8888, true)
                    bitmap.density = DisplayMetrics.DENSITY_DEFAULT

                    CoroutineScope(Dispatchers.Main).launch {
                        val style = mMap.get()?.getStyle()
                        if (style != null) {
                            mImageManager.get()?.resolve(key, bitmap)
                            style.addBitmapImage(key, bitmap, imageEntry.info)
                        } else {
                            Log.e(LOG_TAG, "Failed to get map style to add bitmap: $uri")
                        }
                    }

                    DownloadedImage(key, bitmap, imageEntry.info)
                } else {
                    null
                }
            }
        } catch (e: Throwable) {
            Log.e(LOG_TAG, "Failed to load image: $uri", e)
            null
        } finally {
            dataSource.close()
            result?.let { CloseableReference.closeSafely(it) }
        }
    }

    private fun downloadGifImage(
        key: String,
        uri: String,
        imageEntry: ImageEntry,
        context: Context,
    ): DownloadedImage? {
        return try {
            val inputStream =
                when {
                    uri.startsWith("http://") || uri.startsWith("https://") -> {
                        java.net.URL(uri).openStream()
                    }
                    uri.startsWith("file://") -> {
                        val file = File(Uri.parse(uri).path ?: uri)
                        file.inputStream()
                    }
                    uri.startsWith("/") -> {
                        File(uri).inputStream()
                    }
                    else -> {
                        // Try as resource or asset
                        val resourceId = context.resources.getIdentifier(uri, "drawable", context.packageName)
                        if (resourceId > 0) {
                            context.resources.openRawResource(resourceId)
                        } else {
                            context.assets.open(uri)
                        }
                    }
                }

            // Read all data into a byte array first, then create a ByteArrayInputStream
            // This is required because GifDrawable needs an InputStream that supports marking
            val data = inputStream.use { it.readBytes() }
            val byteArrayInputStream = java.io.ByteArrayInputStream(data)

            val gifDrawable = GifDrawable(byteArrayInputStream)

            // Create bitmap from first frame for immediate display
            val bitmap =
                Bitmap.createBitmap(
                    gifDrawable.intrinsicWidth,
                    gifDrawable.intrinsicHeight,
                    Bitmap.Config.ARGB_8888,
                )
            val canvas = android.graphics.Canvas(bitmap)
            gifDrawable.setBounds(0, 0, canvas.width, canvas.height)
            gifDrawable.draw(canvas)
            bitmap.density = DisplayMetrics.DENSITY_DEFAULT

            CoroutineScope(Dispatchers.Main).launch {
                val style = mMap.get()?.getStyle()
                val map = mMap.get()
                if (style != null && map != null) {
                    mImageManager.get()?.resolve(key, bitmap)
                    // Add the animated GIF to the style
                    style.addBitmapImage(key, bitmap, imageEntry.info)

                    // Start GIF animation
                    startGifAnimation(key, gifDrawable, map, imageEntry.info)
                }
            }

            DownloadedImage(key, bitmap, imageEntry.info)
        } catch (e: Throwable) {
            // Fallback to regular image loading
            return downloadStaticImage(key, uri, imageEntry, context)
        }
    }

    private fun startGifAnimation(
        key: String,
        gifDrawable: GifDrawable,
        map: MapboxMap,
        imageInfo: ImageInfo,
    ) {
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        val mapRef = java.lang.ref.WeakReference(map)

        // Reuse bitmap to avoid allocations
        val reusableBitmap =
            Bitmap.createBitmap(
                gifDrawable.intrinsicWidth,
                gifDrawable.intrinsicHeight,
                Bitmap.Config.ARGB_8888,
            )
        reusableBitmap.density = DisplayMetrics.DENSITY_DEFAULT
        val canvas = android.graphics.Canvas(reusableBitmap)

        val animationRunnable =
            object : Runnable {
                override fun run() {
                    try {
                        val mapInstance = mapRef.get()
                        if (mapInstance == null) {
                            return
                        }

                        // Clear and redraw on the reusable bitmap
                        canvas.drawColor(android.graphics.Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR)
                        gifDrawable.setBounds(0, 0, canvas.width, canvas.height)
                        gifDrawable.draw(canvas)

                        // Update the map image
                        mapInstance.getStyle()?.addBitmapImage(key, reusableBitmap, imageInfo)

                        // Use a reasonable frame rate for GIF animation
                        val frameDelay = 100L // 100ms = 10fps, good balance of smoothness and performance
                        handler.postDelayed(this, frameDelay)
                    } catch (e: Exception) {
                        // Stop animation on error
                    }
                }
            }

        // Start the GIF drawable
        gifDrawable.start()

        // Start the animation updates
        handler.post(animationRunnable)
    }

    companion object {
        const val LOG_TAG = "DownloadMapImageTask"
    }
}
