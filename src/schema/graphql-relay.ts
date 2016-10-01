import {
    GraphQLFieldConfigArgumentMap,
    GraphQLString,
    GraphQLInt,
    GraphQLObjectType,
    GraphQLFieldConfigMap,
    GraphQLList,
    GraphQLNonNull,
    GraphQLBoolean,
    GraphQLResolveInfo,
    GraphQLFieldConfig,
    GraphQLID,
    GraphQLInterfaceType,
    GraphQLInterfaceTypeConfig,
} from 'graphql-rxjs';

export type Base64String = string;

export type ResolvedGlobalId = {
  type: string,
  id: string
}

const PREFIX = 'arrayconnection:';

export function base64(i: string): Base64String {
  return ((new Buffer(i, 'utf8')).toString('base64'));
}

export function unbase64(i: Base64String): string {
  return ((new Buffer(i, 'base64')).toString('utf8'));
}

/**
 * Takes the "global ID" created by toGlobalID, and returns the type name and ID
 * used to create it.
 */
export function fromGlobalId(globalId: string): ResolvedGlobalId {
  var unbasedGlobalId = unbase64(globalId);
  var delimiterPos = unbasedGlobalId.indexOf(':');
  return {
    type: unbasedGlobalId.substring(0, delimiterPos),
    id: unbasedGlobalId.substring(delimiterPos + 1)
  };
}

/**
 * An flow type alias for cursors in this implementation.
 */
export type ConnectionCursor = string

/**
 * A flow type designed to be exposed as `PageInfo` over GraphQL.
 */
export type PageInfo = {
  startCursor?: ConnectionCursor,
  endCursor?: ConnectionCursor,
  hasPreviousPage?: boolean,
  hasNextPage?: boolean
}

/**
 * A flow type designed to be exposed as a `Connection` over GraphQL.
 */
export type Connection<T> = {
  edges: Array<Edge<T>>;
  pageInfo: PageInfo;
}

/**
 * A flow type designed to be exposed as a `Edge` over GraphQL.
 */
export type Edge<T> = {
  node: T;
  cursor: ConnectionCursor;
}

/**
 * A flow type describing the arguments a connection field receives in GraphQL.
 */
export type ConnectionArguments = {
  before?: ConnectionCursor;
  after?: ConnectionCursor;
  first?: number;
  last?: number;
}

export type ArraySliceMetaInfo = {
  sliceStart: number;
  arrayLength: number;
};

/**
 * Rederives the offset from the cursor string.
 */
export function cursorToOffset(cursor: ConnectionCursor): number {
  return parseInt(unbase64(cursor).substring(PREFIX.length), 10);
}

/**
 * Creates the cursor string from an offset.
 */
export function offsetToCursor(offset: number): ConnectionCursor {
  return base64(PREFIX + offset);
}

/**
 * Given an optional cursor and a default offset, returns the offset
 * to use; if the cursor contains a valid offset, that will be used,
 * otherwise it will be the default.
 */
export function getOffsetWithDefault(
  cursor: ConnectionCursor,
  defaultOffset: number
): number {
  if (typeof cursor !== 'string') {
    return defaultOffset;
  }
  var offset = cursorToOffset(cursor);
  return isNaN(offset) ? defaultOffset : offset;
}

/**
 * Given a slice (subset) of an array, returns a connection object for use in
 * GraphQL.
 *
 * This function is similar to `connectionFromArray`, but is intended for use
 * cases where you know the cardinality of the connection, consider it too large
 * to materialize the entire array, and instead wish pass in a slice of the
 * total result large enough to cover the range specified in `args`.
 */
export function connectionFromArraySlice<T>(
  arraySlice: Array<T>,
  args: ConnectionArguments,
  meta: ArraySliceMetaInfo
): Connection<T> {
  var {after, before, first, last} = args;
  var {sliceStart, arrayLength} = meta;
  var sliceEnd = sliceStart + arraySlice.length;
  var beforeOffset = getOffsetWithDefault(before, arrayLength);
  var afterOffset = getOffsetWithDefault(after, -1);

  var startOffset = Math.max(
    sliceStart - 1,
    afterOffset,
    -1
  ) + 1;
  var endOffset = Math.min(
    sliceEnd,
    beforeOffset,
    arrayLength
  );
  if (typeof first === 'number') {
    if (first < 0) {
      throw new Error('Argument "first" must be a non-negative integer');
    }

    endOffset = Math.min(
      endOffset,
      startOffset + first
    );
  }
  if (typeof last === 'number') {
    if (last < 0) {
      throw new Error('Argument "last" must be a non-negative integer');
    }

    startOffset = Math.max(
      startOffset,
      endOffset - last
    );
  }

  // If supplied slice is too large, trim it down before mapping over it.
  var slice = arraySlice.slice(
    Math.max(startOffset - sliceStart, 0),
    arraySlice.length - (sliceEnd - endOffset)
  );

  var edges = slice.map((value, index) => ({
    cursor: offsetToCursor(startOffset + index),
    node: value,
  }));

  var firstEdge = edges[0];
  var lastEdge = edges[edges.length - 1];
  var lowerBound = after ? (afterOffset + 1) : 0;
  var upperBound = before ? beforeOffset : arrayLength;
  return {
    edges,
    pageInfo: {
      startCursor: firstEdge ? firstEdge.cursor : null,
      endCursor: lastEdge ? lastEdge.cursor : null,
      hasPreviousPage:
        typeof last === 'number' ? startOffset > lowerBound : false,
      hasNextPage:
        typeof first === 'number' ? endOffset < upperBound : false,
    },
  };
}

/**
 * A simple function that accepts an array and connection arguments, and returns
 * a connection object for use in GraphQL. It uses array offsets as pagination,
 * so pagination will only work if the array is static.
 */
export function connectionFromArray<T>(
  data: Array<T>,
  args: ConnectionArguments
): Connection<T> {
  return connectionFromArraySlice(
    data,
    args,
    {
      sliceStart: 0,
      arrayLength: data.length,
    }
  );
}

/**
 * Returns a GraphQLFieldConfigArgumentMap appropriate to include on a field
 * whose return type is a connection type with forward pagination.
 */
export var forwardConnectionArgs: GraphQLFieldConfigArgumentMap = {
  after: {
    type: GraphQLString
  },
  first: {
    type: GraphQLInt
  },
};

/**
 * Returns a GraphQLFieldConfigArgumentMap appropriate to include on a field
 * whose return type is a connection type with backward pagination.
 */
export var backwardConnectionArgs: GraphQLFieldConfigArgumentMap = {
  before: {
    type: GraphQLString
  },
  last: {
    type: GraphQLInt
  },
};

/**
 * Returns a GraphQLFieldConfigArgumentMap appropriate to include on a field
 * whose return type is a connection type with bidirectional pagination.
 */
export var connectionArgs: GraphQLFieldConfigArgumentMap = (<any>Object).assign({}, forwardConnectionArgs, backwardConnectionArgs);

export type GraphQLConnectionDefinitions = {
  edgeType: GraphQLObjectType,
  connectionType: GraphQLObjectType
}

export type ConnectionConfig = {
  name?: string,
  nodeType: GraphQLObjectType,
  resolveNode?: Function,
  resolveCursor?: Function,
  edgeFields?: (() => GraphQLFieldConfigMap) | GraphQLFieldConfigMap,
  connectionFields?: (() => GraphQLFieldConfigMap) | GraphQLFieldConfigMap,
}

/**
 * The common page info type used by all connections.
 */
const pageInfoType = new GraphQLObjectType({
  name: 'PageInfo',
  description: 'Information about pagination in a connection.',
  fields: () => ({
    hasNextPage: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: 'When paginating forwards, are there more items?'
    },
    hasPreviousPage: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: 'When paginating backwards, are there more items?'
    },
    startCursor: {
      type: GraphQLString,
      description: 'When paginating backwards, the cursor to continue.'
    },
    endCursor: {
      type: GraphQLString,
      description: 'When paginating forwards, the cursor to continue.'
    },
  })
});

type Thunk<T> = () => T;
function resolveMaybeThunk<T>(thingOrThunk: T | Thunk<T>): T {
  return typeof thingOrThunk === 'function' ? thingOrThunk() : thingOrThunk;
}

/**
 * Returns a GraphQLObjectType for a connection with the given name,
 * and whose nodes are of the specified type.
 */
export function connectionDefinitions(
  config: ConnectionConfig
): GraphQLConnectionDefinitions {
  var {nodeType} = config;
  var name = config.name || nodeType.name;
  var edgeFields = config.edgeFields || {};
  var connectionFields = config.connectionFields || {};
  var resolveNode = config.resolveNode;
  var resolveCursor = config.resolveCursor;
  var edgeType = new GraphQLObjectType({
    name: name + 'Edge',
    description: 'An edge in a connection.',
    fields: () => ((<any>Object).assign({
      node: {
        type: nodeType,
        resolve: resolveNode,
        description: 'The item at the end of the edge',
      },
      cursor: {
        type: new GraphQLNonNull(GraphQLString),
        resolve: resolveCursor,
        description: 'A cursor for use in pagination'
      },
    }, resolveMaybeThunk(edgeFields))),
  });

  var connectionType = new GraphQLObjectType({
    name: name + 'Connection',
    description: 'A connection to a list of items.',
    fields: () => ((<any>Object).assign({
      pageInfo: {
        type: new GraphQLNonNull(pageInfoType),
        description: 'Information to aid in pagination.'
      },
      edges: {
        type: new GraphQLList(edgeType),
        description: 'Information to aid in pagination.'
      },
    }, resolveMaybeThunk(connectionFields))),
  });

  return {edgeType, connectionType};
}

/**
 * Takes a type name and an ID specific to that type name, and returns a
 * "global ID" that is unique among all types.
 */
export function toGlobalId(type: string, id: string): string {
  return base64([type, id].join(':'));
}

/**
 * Creates the configuration for an id field on a node, using `toGlobalId` to
 * construct the ID from the provided typename. The type-specific ID is fetched
 * by calling idFetcher on the object, or if not provided, by accessing the `id`
 * property on the object.
 */
export function globalIdField(
  typeName?: string,
  idFetcher?: (object: any, info: GraphQLResolveInfo) => string
): GraphQLFieldConfig {
  return {
//    name: 'id',
    description: 'The ID of an object',
    type: new GraphQLNonNull(GraphQLID),
    resolve: (obj, args, info) => toGlobalId(
      typeName || info.parentType.name,
      idFetcher ? idFetcher(obj, info) : obj.id
    )
  };
}

export type GraphQLNodeDefinitions = {
  nodeInterface: GraphQLInterfaceType,
  nodeField: GraphQLFieldConfig
}

type typeResolverFn = (object: any) => (GraphQLObjectType | Promise<GraphQLObjectType>);

/**
 * Given a function to map from an ID to an underlying object, and a function
 * to map from an underlying object to the concrete GraphQLObjectType it
 * corresponds to, constructs a `Node` interface that objects can implement,
 * and a field config for a `node` root field.
 *
 * If the typeResolver is omitted, object resolution on the interface will be
 * handled with the `isTypeOf` method on object types, as with any GraphQL
 * interface without a provided `resolveType` method.
 */
export function nodeDefinitions(
  idFetcher: ((id: string, info: GraphQLResolveInfo) => any),
  typeResolver?: typeResolverFn
): GraphQLNodeDefinitions {
  var nodeInterface = new GraphQLInterfaceType(<GraphQLInterfaceTypeConfig> {
    name: 'Node',
    description: 'An object with an ID',
    fields: () => ({
      id: {
        type: new GraphQLNonNull(GraphQLID),
        description: 'The id of the object.',
      },
    }),
    resolveType: typeResolver
  });

  var nodeField = {
    name: 'node',
    description: 'Fetches an object given its ID',
    type: nodeInterface,
    args: {
      id: {
        type: new GraphQLNonNull(GraphQLID),
        description: 'The ID of an object'
      }
    },
    resolve: (obj, {id}, info) => idFetcher(id, info)
  };

  return {nodeInterface, nodeField};
}
