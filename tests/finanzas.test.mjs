import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {handler} from '../netlify/functions/finanzas.mjs';

function configureFunctionTest(t,fetchMock){
 const previousFetch=globalThis.fetch;
 const previousEnv={
  APP_PASSWORD:process.env.APP_PASSWORD,
  GOOGLE_CLIENT_EMAIL:process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY:process.env.GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID:process.env.GOOGLE_SHEET_ID
 };
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 process.env.APP_PASSWORD='test-password';
 process.env.GOOGLE_CLIENT_EMAIL='test@example.iam.gserviceaccount.com';
 process.env.GOOGLE_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'});
 process.env.GOOGLE_SHEET_ID='test-sheet';
 globalThis.fetch=fetchMock;
 t.after(()=>{
  globalThis.fetch=previousFetch;
  for(const [key,value] of Object.entries(previousEnv)){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 });
}

test('reports non-JSON responses from Google Sheets with upstream details', async t=>{
 configureFunctionTest(t,async url=>{
  if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-token'});
  return new Response('<!DOCTYPE html><html><head><title>Bad Request</title></head></html>',{status:400,headers:{'content-type':'text/html'}});
 });
 const result=await handler({httpMethod:'GET',headers:{'x-app-password':'test-password'}});
 const body=JSON.parse(result.body);
 assert.equal(result.statusCode,500);
 assert.match(body.error,/HTTP 400, text\/html.*Bad Request/);
 assert.doesNotMatch(body.error,/Unexpected token/);
});

test('uses summary amounts from Gastos_Ingresos without summing transactions again', async t=>{
 configureFunctionTest(t,async input=>{
  const url=String(input);
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-token'});
  const request=decodeURIComponent(url);
  if(request.includes("'Gastos_Ingresos'!A:Z"))return Response.json({values:[
   ['Dinero Rifa','$405.100'],
   ['Dinero Postres','$422.400'],
   ['Dinero Campistas',''],
   ['Total:','$827.500']
  ]});
  if(request.includes("'Gastos'!A:Z"))return Response.json({values:[['Numero','Fecha','Concepto','Descripcion','Valor','Soporte','UrlFactura']]});
  throw new Error('Unexpected mocked request');
 });

 const result=await handler({httpMethod:'GET',headers:{'x-app-password':'test-password'}});
 const body=JSON.parse(result.body);
 assert.equal(result.statusCode,200);
 assert.deepEqual(body.ingresos,{rifa:405100,postres:422400,otros:0,total:827500});
});
