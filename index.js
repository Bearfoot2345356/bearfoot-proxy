const express = require('express');
const https = require('https');
const crypto = require('crypto');
const app = express();

app.use((req, res, next) => {
  let data = Buffer.alloc(0);
  req.on('data', chunk => { data = Buffer.concat([data, chunk]); });
  req.on('end', () => {
    const str = data.toString('utf8').trim();
    if (!str) { req.body = {}; return next(); }
    try { req.body = JSON.parse(str); return next(); } catch(e) {}
    try { req.body = Object.fromEntries(new URLSearchParams(str)); return next(); } catch(e) {}
    req.body = str;
    next();
  });
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const CONFIG = {
  meta: { token: process.env.META_TOKEN, adAccount: process.env.META_AD_ACCOUNT || 'act_378262932806675', pageId: process.env.META_PAGE_ID || '441555446605737', pixelId: process.env.META_PIXEL_ID || '470255323754555' },
  google: { developerToken: process.env.GOOGLE_DEVELOPER_TOKEN, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, refreshToken: process.env.GOOGLE_REFRESH_TOKEN, managerAccountId: process.env.GOOGLE_MANAGER_ACCOUNT_ID || '4491645864', clientAccountId: process.env.GOOGLE_CLIENT_ACCOUNT_ID || '8166793966' },
  shopify: { accessToken: process.env.SHOPIFY_ACCESS_TOKEN, shop: 'bearfoot-athletics.myshopify.com', apiVersion: '2024-01' },
  uppromote: { apiKey: process.env.UPPROMOTE_API_KEY },
  x: { apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET, accessToken: process.env.X_ACCESS_TOKEN, accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET, bearerToken: process.env.X_BEARER_TOKEN, adsAccountId: process.env.X_ADS_ACCOUNT_ID || '18ce55nt6zg' },
  tiktok: { accessToken: process.env.TIKTOK_ACCESS_TOKEN, advertiserId: process.env.TIKTOK_ADVERTISER_ID || '7257567360448593921', appId: process.env.TIKTOK_APP_ID || '7622939461445222401', appSecret: process.env.TIKTOK_APP_SECRET }
};