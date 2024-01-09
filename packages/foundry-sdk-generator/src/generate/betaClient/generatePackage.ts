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

import type { WireOntologyDefinition } from "@osdk/generator";
import { generateClientSdkVersionOneDotOne } from "@osdk/generator";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { isAbsolute, join, normalize } from "path";
import { generateBundles } from "../generateBundles";
import { bundleDependencies } from "./bundleDependencies";
import { compileInMemory } from "./compileInMemory";
import { generatePackageJson } from "./generatePackageJson";

declare const __OSDK_LEGACY_CLIENT_VERSION__: string | undefined;
const dependencies: { [key: string]: string | undefined } = {
  "@osdk/legacy-client": typeof __OSDK_LEGACY_CLIENT_VERSION__ !== "undefined"
    ? __OSDK_LEGACY_CLIENT_VERSION__
    : undefined,
};

export async function generatePackage(
  ontology: WireOntologyDefinition,
  options: { packageName: string; packageVersion: string; outputDir: string },
) {
  const { consola } = await import("consola");

  const packagePath = join(options.outputDir, options.packageName);
  const resolvedDependencies = await Promise.all(
    Object.keys(dependencies).map(async dependency => {
      return {
        dependencyName: dependency,
        dependencyVersion: await getDependencyVersion(dependency),
      };
    }),
  );
  await mkdir(packagePath, { recursive: true });

  const inMemoryFileSystem: { [fileName: string]: string } = {};
  await generateClientSdkVersionOneDotOne(
    ontology,
    {
      writeFile: async (path, contents) => {
        inMemoryFileSystem[normalize(path)] = contents;
      },
      mkdir: async (path, _options?: { recursive: boolean }) => {
        await mkdir(normalize(path), { recursive: true });
      },
      readdir: path => readdir(path),
    },
    packagePath,
  );

  const compilerOutput = compileInMemory(inMemoryFileSystem);
  compilerOutput.diagnostics.forEach(d =>
    consola.error(`Error compiling file`, d.file?.fileName, d.messageText)
  );

  await mkdir(join(packagePath, "dist", "bundle"), { recursive: true });

  const nodeModulesPath = join(__dirname, "..", "..", "..", "node_modules");

  let bundleDts: string = "";
  try {
    bundleDts = await bundleDependencies(
      [
        join(
          nodeModulesPath,
          "@osdk",
          "legacy-client",
        ),
        join(nodeModulesPath, "@osdk", "api"),
        join(nodeModulesPath, "@osdk", "gateway"),
      ],
      options.packageName,
      compilerOutput.files,
    );
  } catch (e) {
    consola.error("Failed bundling DTS", e);
  }

  await Promise.all([
    ...Object.entries(compilerOutput.files).map(async ([path, contents]) => {
      await writeFile(path, contents, { flag: "w" });
    }),
    await writeFile(
      join(packagePath, "dist", "bundle", "index.d.ts"),
      bundleDts,
      { flag: "w" },
    ),
    generatePackageJson({
      packageName: options.packageName,
      packagePath,
      packageVersion: options.packageVersion,
      dependencies: resolvedDependencies,
    }),
  ]);

  const absolutePackagePath = isAbsolute(options.outputDir)
    ? options.outputDir
    : join(process.cwd(), options.outputDir);

  try {
    await generateBundles(absolutePackagePath, options.packageName);
  } catch (e) {
    consola.error(e);
  }
}

async function getDependencyVersion(dependency: string): Promise<string> {
  if (dependencies[dependency] !== undefined) {
    return dependencies[dependency]!;
  }
  const packageJson = await readFile(join(process.cwd(), "package.json"), {
    encoding: "utf-8",
  });
  if (!packageJson) {
    throw new Error(
      `Could not find package.json in current working directory: ${process.cwd()}`,
    );
  }
  const parsedPackageJson = JSON.parse(packageJson);
  return parsedPackageJson.dependencies[dependency];
}