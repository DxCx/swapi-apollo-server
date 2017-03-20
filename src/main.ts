import * as express from "express";
import { graphqlWs } from "graphql-server-ws";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import * as helmet from "helmet";
import * as morgan from "morgan";
import * as graphqlRxJs from "graphql-rxjs";
import * as bodyParser from "body-parser";
import Schema from "./schema"

import * as url from "url";
import { Server as WsServer } from "ws";

// Default port or given one.
export const GRAPHQL_ROUTE = "/graphql";
export const GRAPHIQL_ROUTE = "/graphiql";

interface IMainOptions {
    enableGraphiql: boolean;
    env: string;
    port: number;
    verbose?: boolean;
};

/* istanbul ignore next: no need to test verbose print */
function verbosePrint(port, enableGraphiql) {
    console.log(`GraphQL Server is now running on http://localhost:${port}${GRAPHQL_ROUTE}`);
    if ( true === enableGraphiql  ) {
        console.log(`GraphiQL Server is now running on http://localhost:${port}${GRAPHIQL_ROUTE}`);
    }
}

export function main(options: IMainOptions) {
    let app = express();
    app.use(helmet());
    app.use(morgan(options.env));

    app.use(GRAPHQL_ROUTE, bodyParser.json(), graphqlExpress({
      schema: Schema,
      context: {},
    }));

    if ( true === options.enableGraphiql ) {
        app.use(GRAPHIQL_ROUTE, graphiqlExpress({
            endpointURL: GRAPHQL_ROUTE,
        }));

        app.use(`${GRAPHIQL_ROUTE}-ws`, graphiqlExpress({
            endpointURL: `ws://localhost:${options.port}${GRAPHQL_ROUTE}`,
        }));
    }

    return new Promise((resolve, reject) => {
        let server = app.listen(options.port, () => {
            /* istanbul ignore if: no need to test verbose print */
            if ( options.verbose ) {
                verbosePrint(options.port, options.enableGraphiql);
            }

            resolve(server);
        }).on("error", (err: Error) => {
            reject(err);
        });
    }).then((server) => {
        let wss = new WsServer({ server: <any> server });

        wss.on("connection", graphqlWs((ws) => {
            const location = url.parse(ws.upgradeReq.url, true);

            // Multiplex ws connections by path.
            switch ( location.pathname ) {
               case GRAPHQL_ROUTE:
                   return {
                       context: {},
                       schema: Schema,
                       executor: graphqlRxJs,
                   };
               default:
                   ws.terminate();
                   return undefined;
            }
        }));
        return server;
    });
}

/* istanbul ignore if: main scope */
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    // Either to export GraphiQL (Debug Interface) or not.
    const NODE_ENV = process.env.NODE_ENV !== "production" ? "dev" : "production";
    const EXPORT_GRAPHIQL = NODE_ENV !== "production";

    main({
        enableGraphiql: EXPORT_GRAPHIQL,
        env: NODE_ENV,
        port: PORT,
        verbose: true,
    });
}
