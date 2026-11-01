import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'fs';
import https from 'https';
import MQTT from 'mqtt';
import type { AddressInfo } from 'net';
import { createAuthHandler, DeedooConf, logListenAddr, requireNonNullish } from './misc.mjs';
import { createSite } from './site.mjs';

// Conf
const conf = ( await import( new URL( '../conf.mjs', import.meta.url ).href ) ).default as DeedooConf;

// MQTT
const mqtt = MQTT.connect( conf.mqtt );

// Routes
const app = express( );
app.use( cookieParser( conf.https.cookieSigningSecret ) );
app.use( createAuthHandler( conf.https ) );
for ( const [ path, site ] of Object.entries( conf.sites ) ) {
    const siteHandler = await createSite( site, mqtt, path );
    app.use( '/' + path, siteHandler );
}

// HTTPS
const httpsKey = fs.readFileSync( conf.https.keyFile );
const httpsCert = fs.readFileSync( conf.https.certFile );
const server = https.createServer( { key: httpsKey, cert: httpsCert }, app );
server.on( 'listening', ( ) => {
    logListenAddr( requireNonNullish( server.address( ) ) as AddressInfo, true );
} );
server.listen( conf.https.port, conf.https.host );
