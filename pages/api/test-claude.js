export default async function handler(req, res) {
  try {
    console.log('Testing Claude API...');
    console.log('API Key present:', !!process.env.ANTHROPIC_API_KEY);
    console.log('API Key starts with:', process.env.ANTHROPIC_API_KEY?.substring(0, 10));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: 'Say "API test successful" if you can read this.',
          },
        ],
      }),
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', JSON.stringify([...response.headers.entries()]));

    const data = await response.json();
    console.log('Response body:', JSON.stringify(data, null, 2));

    if (response.ok) {
      return res.status(200).json({
        success: true,
        message: 'Claude API is working!',
        claudeResponse: data.content[0].text,
      });
    } else {
      return res.status(response.status).json({
        success: false,
        status: response.status,
        error: data,
      });
    }

  } catch (error) {
    console.error('Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
