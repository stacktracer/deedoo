import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PUBLIC_DIR = join(import.meta.dirname, 'public');

const STATIC_FILES = {
    '/mah/': ['mah/index.html', 'text/html; charset=utf-8'],
    '/mah/index.html': ['mah/index.html', 'text/html; charset=utf-8'],
    '/khh/': ['/khh/index.html', 'text/html; charset=utf-8'],
    '/khh/index.html': ['khh/index.html', 'text/html; charset=utf-8'],
    '/app.css': ['app.css', 'text/css; charset=utf-8'],
    '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
};

export async function serveStatic(method, path) {
    const entry = STATIC_FILES[path];
    if (!entry) {
        return null;
    }
    const [filename, contentType] = entry;
    const body = method === 'HEAD'
        ? undefined
        : await readFile(join(PUBLIC_DIR, filename), 'utf8');
    return {
        statusCode: 200,
        headers: { 'Content-Type': contentType },
        body,
    };
}
