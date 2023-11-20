/*
 * Copyright 2023 Palantir Technologies, Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  ObjectTypesFrom,
  OntologyDefinition,
  OsdkObjectFrom,
  PropertyKeysFrom,
  ThinClient,
} from "@osdk/api";
import { createOpenApiRequest } from "@osdk/api";
import { loadObjectSetV2 } from "@osdk/gateway/requests";
import type { LoadObjectSetRequestV2 } from "@osdk/gateway/types";
import type { Wire } from "../internal/net";
import type { PageResult } from "../PageResult";
import type { NOOP } from "../util/NOOP";
import { convertWireToOsdkObjects } from "./convertWireToOsdkObjects";

export interface FetchPageOrThrowArgs<
  O extends OntologyDefinition<any>,
  K extends ObjectTypesFrom<O>,
  L extends PropertyKeysFrom<O, K>,
> {
  select?: readonly L[];
  nextPageToken?: string;
}

export async function fetchPageOrThrow<
  O extends OntologyDefinition<any>,
  T extends ObjectTypesFrom<O>,
  const A extends FetchPageOrThrowArgs<O, T, PropertyKeysFrom<O, T>>,
>(
  client: ThinClient<O>,
  objectType: T & string,
  args: A,
  objectSet: Wire.ObjectSet = {
    type: "base",
    objectType,
  },
): Promise<
  PageResult<
    NOOP<
      OsdkObjectFrom<
        T,
        O,
        A["select"] extends readonly string[] ? A["select"][number]
          : PropertyKeysFrom<O, T>
      >
    >
  >
> {
  const body: LoadObjectSetRequestV2 = {
    objectSet,
    // We have to do the following case because LoadObjectSetRequestV2 isnt readonly
    select: (args?.select ?? []) as unknown as string[], // FIXME?
  };

  if (args?.nextPageToken) {
    body.pageToken = args.nextPageToken;
  }

  const r = await loadObjectSetV2(
    createOpenApiRequest(
      client.stack,
      client.fetch as typeof fetch,
    ),
    client.ontology.metadata.ontologyApiName,
    body,
  );

  convertWireToOsdkObjects(client, objectType, r.data);

  // any is okay here because we have properly converted the wire objects via prototypes
  // which don't type out correctly.
  return r as any;
}