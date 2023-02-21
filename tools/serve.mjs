#!/usr/bin/env node

import express from 'express';
import http from 'http';
import os from 'os';
import url from 'url';

// Parse cli args
const args = process.argv.slice( 2 );
if ( args.length === 0 || args[0] === '--help' ) {
    const redStar = '\x1b[1;31m*\x1b[0m';
    console.log( ` ${redStar} Usage: ${process.argv[0]} ${process.argv[1]} <listen-host> <listen-port>` );
    process.exit( 2 );
}
const host = args[ 0 ];
const port = parseInt( args[ 1 ] );

// Create routes
const app = express( );
const distDir = new URL( '../build/dist', import.meta.url ).pathname;
app.use( '/', express.static( distDir ) );

// Serve
const server = http.createServer( app );
server.on( 'listening', ( ) => {
    const { family, address, port } = server.address( );

    // Log the known interfaces we're listening on
    let ifaceFound = false;
    const isAllInterfaces = ( family === 'IPv4' && address === '0.0.0.0' ) || ( family === 'IPv6' && address === '::' );
    for ( const [ ifaceName, ifaceAddrs ] of Object.entries( os.networkInterfaces( ) ) ) {
        for ( const ifaceAddr of ifaceAddrs ) {
            if ( ifaceAddr.family === family && ( isAllInterfaces || ifaceAddr.address === address ) ) {
                const ifaceUrl = url.format( {
                    protocol: 'http',
                    hostname: ( family === 'IPv4' ? ifaceAddr.address : `[${ifaceAddr.address}]` ),
                    port,
                } );
                console.log( `Serving at  ${ifaceUrl}  (${ifaceName})` );
                ifaceFound = true;
            }
        }
    }

    // Log if we're listening on an unknown interface
    if ( !ifaceFound ) {
        const addrUrl = url.format( {
            protocol: 'http',
            hostname: ( family === 'IPv4' ? address : `[${address}]` ),
            port,
        } );
        console.log( `Serving at  ${addrUrl}  (???)` );
    }
} );
server.listen( port, host );
