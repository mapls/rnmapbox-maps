package com.rnmapbox.rnmbx.components.images

import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import com.rnmapbox.rnmbx.v11compat.Cancelable
import com.mapbox.maps.Image
import com.rnmapbox.rnmbx.v11compat.image.toMapboxImage

/**
ImageManager helps to resolve images defined by any of RNMBXImages component.
 */

fun interface Resolver {
    fun resolved(name: String, image: Image)
}
class Subscription(val name:String, val resolver: Resolver, val manager: ImageManager): Cancelable {

    fun resolved(name: String, image: Image) {
        resolver.resolved(name, image)
    }
    override fun cancel() {
        manager.unsubscribe(this)
    }
}

class ImageManager {
    var subscriptions: MutableMap<String, MutableList<Subscription>> = hashMapOf()
    // Keep strong references to animated GIFs to prevent GC stopping animations
    private val animatedGifs: MutableMap<String, pl.droidsonroids.gif.GifDrawable> = hashMapOf()

    fun subscribe(name: String, resolved: Resolver) : Subscription {
        val list = subscriptions.getOrPut(name) { mutableListOf() }
        val result = Subscription(name, resolved, this)
        list.add(result)
        return result
    }
    fun unsubscribe(subscription: Subscription) {
        var list = subscriptions[subscription.name]
        list?.removeAll { it === subscription }
    }

    fun resolve(name: String, image: Image) {
        subscriptions[name]?.forEach {
            it.resolved(name, image)
        }
    }

    fun resolve(name: String, image: Bitmap) {
        resolve(name, image.toMapboxImage())
    }

    fun resolve(name: String, image: BitmapDrawable) {
        resolve(name, image.bitmap)
    }

    fun registerAnimatedGif(name: String, drawable: pl.droidsonroids.gif.GifDrawable) {
        animatedGifs[name] = drawable
    }

    fun unregisterAnimatedGif(name: String) {
        animatedGifs.remove(name)?.let { d ->
            try {
                d.stop()
            } catch (_: Throwable) {}
            try {
                d.callback = null
            } catch (_: Throwable) {}
        }
    }

    fun clearAnimatedGifs() {
        val values = animatedGifs.values.toList()
        animatedGifs.clear()
        values.forEach { d ->
            try { d.stop() } catch (_: Throwable) {}
            try { d.callback = null } catch (_: Throwable) {}
        }
    }

    fun isGifRegistered(name: String, drawable: pl.droidsonroids.gif.GifDrawable? = null): Boolean {
        val d = animatedGifs[name] ?: return false
        return drawable == null || d === drawable
    }
}
