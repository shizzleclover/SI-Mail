const express = require('express');
const router = express.Router();
const { oauth2Client, GMAIL_SCOPES } = require('../config/oauth');

// Google OAuth login route
router.get('/google', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GMAIL_SCOPES,
        include_granted_scopes: true,
        prompt: 'consent'
    });
    res.redirect(authUrl);
});

// OAuth callback route
router.get('/google/callback', async (req, res) => {
    try {
        const { code } = req.query;
        const { tokens } = await oauth2Client.getToken(code);
        
        // Store tokens in session
        req.session.tokens = tokens;
        
        // Get user info
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data } = await oauth2.userinfo.get();
        
        // Store user email
        req.session.email = data.email;
        
        res.redirect('/?auth=success');
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect('/?auth=error');
    }
});

// Auth status route
router.get('/status', (req, res) => {
    res.json({
        authenticated: !!req.session.tokens,
        email: req.session.email
    });
});

// Logout route
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

module.exports = router; 