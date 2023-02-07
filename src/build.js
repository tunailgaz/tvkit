// @ts-check
import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import * as terser from "terser";
import browserslist from "browserslist";
import generatePolyfills from "./generatePolyfills.js";
import transformHtml from "./transformHtml.js";
import transformJavascript from "./transformJavascript.js";
import transformCss from "./transformCss.js";
import isSupported from "./isSupported.js";

/**
 * @param {string} folder The input folder
 * @param {string} out The output folder
 * @param {string} browser browserslist compatible browser
 * @param {{css:boolean, minify:boolean, force:boolean}} flags
 * flags.css: Also transform css
 * flags.minify: Minify output
 * flags.force: Overwrite existing output folder
 */
export default async function build(
  folder,
  out,
  browser,
  { css, minify, force }
) {
  if (!force && (await fs.stat(out).catch(() => false))) {
    process.stderr.write(
      "\noutput folder already exists, use --force to overwrite\n\n"
    );
    process.exit(1);
  }
  const browsers = browserslist(browser);
  await processFolder(folder, out, {
    base: path.resolve(folder),
    browsers,
    css,
    minify,
  });
  await generatePolyfills(browsers).then((code) => {
    fs.writeFile(path.resolve(out, "tvkit-polyfills.js"), code, "utf-8");
    console.info("✅", "tvkit-polyfills.js");
  });
  const esm = isSupported(
    ["es6-module", "es6-module-dynamic-import"],
    browsers
  );
  if (!esm) {
    const require = createRequire(import.meta.url);
    await fs.copyFile(
      require.resolve("systemjs/dist/s.min.js"),
      path.join(out, "tvkit-system.js")
    );
    console.info("⏩", "tvkit-system.js");
    await fs.copyFile(
      require.resolve("systemjs/dist/s.min.js"),
      path.join(out, "s.min.js.map")
    );
    console.info("⏩", "s.min.js.map");
  }
}

/**
 * @param {string} folder
 * @param {string} out
 * @param {{base: string, browsers: string[], css: boolean, minify: boolean}} options
 */
async function processFolder(folder, out, { base, browsers, css, minify }) {
  if ((await fs.stat(out).catch(() => false)) === false) {
    await fs.mkdir(out);
  }
  const entries = await fs.readdir(folder);
  /** @type {Array<{path: string, out: string}>}  */
  const subfolders = [];
  await Promise.all(
    entries.map(async (entry) => {
      const filepath = path.resolve(folder, entry);
      const outpath = path.resolve(out, entry);
      const info = await fs.stat(filepath);
      if (info.isDirectory()) {
        subfolders.push({
          path: filepath,
          out: path.resolve(out, entry),
        });
        return;
      }
      if (entry.startsWith(".")) {
        return;
      }
      if (entry.endsWith(".js")) {
        processFile(base, filepath, outpath, async (source) => {
          const code = await transformJavascript(source, { browsers });
          if (!minify) {
            return code;
          }
          const minified = await terser.minify(code, {
            ecma: 5,
            safari10: true,
          });
          return minified.code ?? code;
        });
      } else if (entry.endsWith(".html") || entry.endsWith(".htm")) {
        processFile(base, filepath, outpath, (source) =>
          transformHtml(source, { browsers })
        );
      } else if (css && entry.endsWith(".css")) {
        processFile(base, filepath, outpath, (source) =>
          transformCss(source, { browsers, from: filepath })
        );
      } else {
        await fs.copyFile(filepath, outpath);
        console.info("⏩", filepath.substring(base.length));
      }
    })
  );
  await Promise.all(
    subfolders.map((subfolder) => {
      return processFolder(subfolder.path, subfolder.out, {
        base,
        browsers,
        minify,
        css,
      });
    })
  );
}

/**
 * @param {string} base Base input path
 * @param {string} input Path of the source file
 * @param {string} output Path of the target file
 * @param {(code: string) => Promise<string>} transformer
 */
async function processFile(base, input, output, transformer) {
  const source = await fs.readFile(input, "utf-8");
  const transformed = await transformer(source);
  await fs.writeFile(output, transformed);
  console.info("✅", input.substring(base.length));
}
