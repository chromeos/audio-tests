import nodeResolve from '@rollup/plugin-node-resolve';
import html from '@web/rollup-plugin-html';
import { importMetaAssets } from '@web/rollup-plugin-import-meta-assets';
import esbuild from 'rollup-plugin-esbuild';

export default {
  input: 'index.html',
  output: {
    entryFileNames: '[hash].js',
    chunkFileNames: '[hash].js',
    assetFileNames: '[hash][extname]',
    format: 'es',
    dir: 'dist',
  },
  preserveEntrySignatures: false,

  plugins: [
    /** Enable using HTML as rollup entrypoint */
    html({}),
    /** Resolve bare module imports */
    nodeResolve(),
    /** Minify JS */
    esbuild({
      minify: true,
    }),
    /** Bundle assets references via import.meta.url */
    importMetaAssets(),
  ],
};
