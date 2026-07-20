import { createContext } from 'react';

/**
 * Provides the enclosing ShapeSource's id to child layer components, mirroring
 * the native behavior where layers inherit their parent's sourceID. An explicit
 * sourceID prop on a layer takes precedence.
 */
const SourceContext = createContext<{ sourceID?: string }>({});

export default SourceContext;
