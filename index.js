const express = require('express');
const https = require('https');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const CONFIG = {
  meta: {
    token: 'EAARQ3HPftCIBQZCZCMucYRvSNC18PVBfc4V2fZBZB4pP2Ku4hefI3MUrBoeQrJG4tsZBsz38mnWvMieTDMF2g7bMSjjmAAjFsIounRiB9sbpEqZA6LtnpcptdWcWSw789MZAVdyopljt3xmcTDFptbARBU127oPVdd645djxkZBNiaM0tYCWodeU2ECvRqmFUwZDZD',
    adAccount: 'act_378262932806675',
    pageId: '441555446605737',
    pixelId: '470255323754555'
  },
  google: {
    developerToken: '9ROaoYVnG3mY8hWPdye5cw',
    clientId: '6736684714-aas0ved9nrml829deu6d7jgf4j388p5s.apps.googleusercontent.com',
    clientSecret: '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',
    refreshToken: '1//0446qI9tspJjsCgYIARAAGAQSNwF-L9Ir0Twn0Y9RBe2UPWh_9_ROqB2a0ZT6sPa4xkllI_50oWtDlIwiq-NUoWMrJzz5xvA8Prg',
    managerAccountId: '4491645864',
    clientAccountId: '8166793966'
  }
};

// In-memory job store
const jobs = {};

app.get('/config', (req, res) => {
  res.json({
    meta: { adAccount: CONFIG.meta.adAccount, pageId: CONFIG.meta.pageId, pixelId: CONFIG.meta.pixelId },
    google: { managerAccountId: CONFIG.google.managerAccountId, clientAccountId: CONFIG.google.clientAccountId }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

function keepAlive() {
  https.get('https://bearfoot-proxy.onrender.com/health', (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => console.log('ping:', new Date().toISOString()));
  }).on('error', e => console.log('ping error:', e.message));
}
setInterval(keepAlive, 14 * 60 * 1000);

// META
function metaRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `/v19.0${path}${sep}access_token=${CONFIG.meta.token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = { hostname: 'graph.facebook.com', path: fullPath, method, headers: { 'Content-Type': 'application/json' } };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.get('/api/meta', async (req, res) => {
  try { res.json(await metaRequest('GET', req.query.path)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/meta', async (req, res) => {
  try { res.json(await metaRequest('POST', req.query.path, req.body)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/meta', async (req, res) => {
  try { res.json(await metaRequest('DELETE', req.query.path)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// GOOGLE
let gToken = null, gExpiry = 0;

async function getGToken() {
  if (gToken && Date.now() < gExpiry) return gToken;
  const body = new URLSearchParams({
    client_id: CONFIG.google.clientId,
    client_secret: CONFIG.google.clientSecret,
    refresh_token: CONFIG.google.refreshToken,
    grant_type: 'refresh_token'
  }).toString();
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const p = JSON.parse(d);
        if (p.error) return reject(new Error(p.error_description || p.error));
        gToken = p.access_token;
        gExpiry = Date.now() + (p.expires_in - 60) * 1000;
        resolve(gToken);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function gRequest(method, path, body) {
  const token = await getGToken();
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'googleads.googleapis.com', path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': CONFIG.google.developerToken,
        'login-customer-id': CONFIG.google.managerAccountId,
        'Content-Type': 'application/json'
      }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        console.log('Google', method, path.split('/').pop(), 'status:', r.statusCode);
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.post('/api/google/query', async (req, res) => {
  const query = req.body && req.body.query;
  if (!query) return res.status(400).json({ error: 'Missing query', received: req.body });
  try {
    const result = await gRequest('POST',
      `/v20/customers/${CONFIG.google.clientAccountId}/googleAds:searchStream`,
      { query }
    );
    res.json(result.data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/google/mutate', async (req, res) => {
  const { resource, operations } = req.body || {};
  if (!operations) return res.status(400).json({ error: 'Missing operations' });
  try {
    const result = await gRequest('POST',
      `/v20/customers/${CONFIG.google.clientAccountId}/${resource}:mutate`,
      { operations }
    );
    res.json(result.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ASYNC CAMPAIGN CREATION
async function runCampaignCreation(jobId, campaignName, dailyBudgetDollars, adGroups) {
  const customerId = CONFIG.google.clientAccountId;
  const job = jobs[jobId];

  try {
    // Step 1: Budget
    job.step = 'Creating budget';
    const budgetResult = await gRequest('POST',
      `/v20/customers/${customerId}/campaignBudgets:mutate`,
      { operations: [{ create: {
        name: `${campaignName} Budget`,
        amountMicros: String((dailyBudgetDollars || 50) * 1000000),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false
      }}]}
    );
    if (budgetResult.status !== 200) throw new Error('Budget failed: ' + JSON.stringify(budgetResult.data));
    const budgetResourceName = budgetResult.data.results[0].resourceName;
    job.results.budget = budgetResourceName;

    // Step 2: Campaign
    job.step = 'Creating campaign';
    const campaignResult = await gRequest('POST',
      `/v20/customers/${customerId}/campaigns:mutate`,
      { operations: [{ create: {
        name: campaignName,
        status: 'PAUSED',
        advertisingChannelType: 'SEARCH',
        campaignBudget: budgetResourceName,
        maximizeConversions: {},
        networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false }
      }}]}
    );
    if (campaignResult.status !== 200) throw new Error('Campaign failed: ' + JSON.stringify(campaignResult.data));
    const campaignResourceName = campaignResult.data.results[0].resourceName;
    job.results.campaign = { resourceName: campaignResourceName, id: campaignResourceName.split('/').pop() };

    // Step 3: Ad groups
    if (adGroups && adGroups.length > 0) {
      for (const ag of adGroups) {
        job.step = `Creating ad group: ${ag.name}`;
        const agResult = {};

        const adGroupResult = await gRequest('POST',
          `/v20/customers/${customerId}/adGroups:mutate`,
          { operations: [{ create: {
            name: ag.name,
            campaign: campaignResourceName,
            status: 'ENABLED',
            type: 'SEARCH_STANDARD'
          }}]}
        );
        if (adGroupResult.status !== 200) { agResult.error = adGroupResult.data; job.results.adGroups.push(agResult); continue; }
        const adGroupResourceName = adGroupResult.data.results[0].resourceName;
        agResult.adGroup = { resourceName: adGroupResourceName, id: adGroupResourceName.split('/').pop(), name: ag.name };

        // Keywords
        if (ag.keywords && ag.keywords.length > 0) {
          const kwResult = await gRequest('POST',
            `/v20/customers/${customerId}/adGroupCriteria:mutate`,
            { operations: ag.keywords.map(kw => ({ create: { adGroup: adGroupResourceName, text: kw, matchType: 'BROAD' }})) }
          );
          agResult.keywordsCreated = kwResult.status === 200 ? kwResult.data.results.length : 0;
          if (kwResult.status !== 200) agResult.keywordsError = kwResult.data;
        }

        // Ad
        if (ag.ad) {
          const adResult = await gRequest('POST',
            `/v20/customers/${customerId}/adGroupAds:mutate`,
            { operations: [{ create: {
              adGroup: adGroupResourceName,
              status: 'ENABLED',
              ad: {
                finalUrls: [ag.ad.finalUrl || 'https://bearfoot.store'],
                responsiveSearchAd: {
                  headlines: ag.ad.headlines.map(h => ({ text: h })),
                  descriptions: ag.ad.descriptions.map(d => ({ text: d }))
                }
              }
            }}]}
          );
          agResult.adCreated = adResult.status === 200;
          if (adResult.status !== 200) agResult.adError = adResult.data;
        }

        job.results.adGroups.push(agResult);
      }
    }

    job.status = 'done';
    job.step = 'Complete';
  } catch(e) {
    job.status = 'error';
    job.error = e.message;
  }
}

app.post('/api/google/create-campaign', async (req, res) => {
  const { campaignName, dailyBudgetDollars, adGroups } = req.body || {};
  if (!campaignName) return res.status(400).json({ error: 'Missing campaignName' });

  const jobId = Date.now().toString();
  jobs[jobId] = { status: 'running', step: 'Starting', results: { budget: null, campaign: null, adGroups: [] } };

  // Start async — respond immediately
  runCampaignCreation(jobId, campaignName, dailyBudgetDollars, adGroups);

  res.json({ jobId, status: 'running', message: 'Campaign creation started. Poll /api/google/job/:jobId for status.' });
});

app.get('/api/google/job/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Bearfoot proxy v5 running');
  setTimeout(keepAlive, 60 * 1000);
});