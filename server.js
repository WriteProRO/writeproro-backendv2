const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-PASTE_YOUR_ACTUAL_API_KEY_HERE',
});

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.API_RATE_LIMIT) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'file://',
  'https://writeproro-frontend.vercel.app',
  '*'  // Allow all origins for now - restrict in production
];
app.use(cors({
  origin: true, // Allow all origins for local HTML files
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Debug endpoint (remove after testing)
app.get('/debug', (req, res) => {
  res.json({ 
    hasApiKey: !!process.env.OPENAI_API_KEY,
    keyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
    keyStart: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 7) : 'none',
    hardcodedFallback: process.env.OPENAI_API_KEY ? 'using env var' : 'using hardcoded'
  });
});

// Main AI generation endpoint
app.post('/api/generate-documentation', async (req, res) => {
  try {
    const { vin, system, dtcCodes, techNotes, dealership, technician } = req.body;

    // Validation
    if (!vin || !system || !techNotes) {
      return res.status(400).json({ 
        error: 'Missing required fields: vin, system, techNotes' 
      });
    }

    if (vin.length !== 17) {
      return res.status(400).json({ 
        error: 'VIN must be exactly 17 characters' 
      });
    }

    // Create the prompt for GPT-4
    const systemPrompt = process.env.CUSTOM_SYSTEM_PROMPT || `You are writing technician service documentation using Gary Wellington's exact warranty repair documentation style from Bob King Buick GMC. Write in ALL CAPS format using past tense actions describing work performed.

REAL TRAINING EXAMPLES:

DTC P2C7A Example:
CAUSE: PERFORMED DIAGNOSIS USING GDS2 FOR DTC P2C7A – NOX SYSTEM EFFICIENCY BELOW THRESHOLD. UTILIZED SMOKE MACHINE TO CHECK FOR EXHAUST AND INTAKE LEAKS. FOUND CRACK IN INTAKE MANIFOLD ALLOWING UNMETERED AIR ENTRY.
CORRECTION: REMOVED AND REPLACED INTAKE MANIFOLD ASSEMBLY. CLEARED DTCs AND VERIFIED REPAIR. RE-RAN GDS2 SYSTEM TESTS.

Transmission Example:
CAUSE: CONNECTED GDS2 AND VERIFIED DTCs P1789, P18AB, P2723, AND P27EC. REMOVED TRANSMISSION PAN AND VALVE BODY FOR INSPECTION. FOUND VALVE BODY SEAL CUT AND PINCHED FROM FACTORY INSTALLATION.
CORRECTION: REPLACED DAMAGED VALVE BODY SEAL WITH NEW OEM SEAL. FILLED TRANSMISSION WITH NEW APPROVED ATF. PERFORMED FUNCTIONAL SHIFT VERIFICATION USING GDS2.

Engine Seizure Example:
CAUSE: VERIFIED VEHICLE IS COMPLETELY INOPERATIVE. REMOVED INTAKE TUBE AND MANUALLY ATTEMPTED TO ROTATE ENGINE - NO ROTATION POSSIBLE. FOUND ENGINE SEIZED DUE TO LOWER-END BEARING FAILURE.
CORRECTION: INSTALLED GM REPLACEMENT ENGINE ASSEMBLY. PERFORMED OIL SYSTEM PRIMING PROCEDURE USING FACTORY-APPROVED PRE-LUBE TOOL (EN-45299).

GARY WELLINGTON'S DOCUMENTATION STYLE:
- Always start with "CUSTOMER STATES" or "VERIFIED"
- Use specific GM diagnostic tools (GDS2, PICO, etc.)
- Detail exact diagnostic steps performed
- State specific part failures found
- Use GM part numbers and procedures
- Include verification and road testing
- End with "REPAIR COMPLETE" or "OPERATES AS DESIGNED"`;

    const userPrompt = `Write warranty repair documentation for this service:

VEHICLE: ${vin}
SYSTEM: ${system} 
DTC CODES: ${dtcCodes || 'None'}
CUSTOMER CONCERN: ${techNotes}

Write in proper warranty documentation format:

**CAUSE:**
[Customer complaint, diagnostic steps performed, findings - ALL CAPS format]

**CORRECTION:**
[Specific repair actions taken, procedures performed - ALL CAPS format]

Write as completed warranty repair documentation. Use ALL CAPS format and past tense actions. Keep under 300 words.`;

    // Call OpenAI GPT-4
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 500, // Allow for detailed Gary Wellington style documentation
      temperature: 0.1, // Very low temperature for consistent, specific responses
    });

    const generatedContent = completion.choices[0].message.content;

    // Log the request for monitoring (without sensitive data)
    console.log(`[${new Date().toISOString()}] Documentation generated for VIN: ${vin.slice(-4)}, System: ${system}`);

    res.json({
      success: true,
      content: generatedContent,
      metadata: {
        model: completion.model,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
        system: system,
        vin_last_4: vin.slice(-4)
      }
    });

  } catch (error) {
    console.error('OpenAI API Error:', error);
    
    // Handle different types of errors
    if (error.code === 'insufficient_quota') {
      return res.status(402).json({ 
        error: 'OpenAI API quota exceeded. Please check your billing.' 
      });
    }
    
    if (error.code === 'invalid_api_key') {
      return res.status(401).json({ 
        error: 'Invalid OpenAI API key configuration.' 
      });
    }

    res.status(500).json({ 
      error: 'Internal server error during AI generation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`WriteProRO Backend Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`OpenAI API Key configured: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
  if (process.env.OPENAI_API_KEY) {
    console.log(`API Key starts with: ${process.env.OPENAI_API_KEY.substring(0, 7)}...`);
  }
});

module.exports = app;