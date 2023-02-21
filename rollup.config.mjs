import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';

export default {
    input: new URL( './build/temp/main.js', import.meta.url ).pathname,
    plugins: [
        resolve( ),
        commonjs( ),
    ],
    output: [ {
        file: new URL( './build/dist/main.js', import.meta.url ).pathname,
        format: 'umd',
        sourcemap: true,
        indent: false,
    } ],
    watch: { clearScreen: false },
}
