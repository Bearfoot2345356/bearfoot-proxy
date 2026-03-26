// Bearfoot Proxy - v8
// Version: proxy v8 running

const express = require('express');
const { google } = require('google-ads-api');

const app = express();
app.use(express.json());

// Campaign creation function
async function runCampaignCreation(customerId, campaignName, budgetResourceName) {
  const client = new google.ads.googleads.v14.GoogleAdsServiceClient();
  
  const campaignOperation = {
    create: {
      name: campaignName,
      status: 'PAUSED',
      advertisingChannelType: 'SEARCH',
      campaignBudget: budgetResourceName,
      maximizeConversions: {},
      networkSettings: {
        targetGoogleSearch: true,
        targetSearchNetwork: true,
        targetContentNetwork: false
      }
    }
  };

  try {
    const response = await client.mutateCampaigns({
      customerId: customerId,
      operations: [campaignOperation]
    });
    
    console.log('Campaign created successfully');
    return response;
  } catch (error) {
    console.error('Error creating campaign:', error);
    throw error;
  }
}

app.post('/create-campaign', async (req, res) => {
  try {
    const { customerId, campaignName, budgetResourceName } = req.body;
    const result = await runCampaignCreation(customerId, campaignName, budgetResourceName);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bearfoot proxy v8 running on port ${PORT}`);
});

module.exports = { runCampaignCreation };