export default async function handler(req, res) {
  try {
    console.log('Testing Hunt API integration...');

    // Create dummy spec text
    const specText = `ABSTRACT

A system for testing patent processing comprising a mobile interface, artificial intelligence components, and data processing modules.

BACKGROUND

This is a test specification for validating the Hunt API integration.

SUMMARY

The invention relates to testing systems.

DETAILED DESCRIPTION

Figure 1 shows a system architecture with multiple components interconnected for processing patent data.`;

    // Create dummy drawing PDF (minimal valid PDF)
    const drawingPdfBase64 = 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PC9Gb250PDw+Pj4+Pj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoyMjIKJSVFT0Y=';
    const drawingBuffer = Buffer.from(drawingPdfBase64, 'base64');

    console.log(`Spec text: ${specText.length} chars`);
    console.log(`Drawing PDF: ${drawingBuffer.length} bytes`);

    // Create multipart form data
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    
    const parts = [];
    
    // Add spec.txt file
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="TEST-spec.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `${specText}\r\n`
    );
    
    // Add drawings.pdf file
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="TEST-drawings.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    );
    
    const body = Buffer.concat([
      Buffer.from(parts[0], 'utf8'),
      Buffer.from(parts[1], 'utf8'),
      drawingBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    ]);
    
    console.log(`Total body size: ${body.length} bytes`);
    console.log('Sending to Hunt API...');
    
    // Send to Hunt
    const huntResponse = await fetch('https://monitoring.trogonpatent.ai/api/upload-provisional', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });
    
    console.log('Hunt response status:', huntResponse.status);
    console.log('Hunt response headers:', JSON.stringify([...huntResponse.headers.entries()]));
    
    const huntData = await huntResponse.json();
    console.log('Hunt response body:', JSON.stringify(huntData, null, 2));
    
    if (!huntResponse.ok) {
      return res.status(huntResponse.status).json({
        success: false,
        error: 'Hunt API error',
        status: huntResponse.status,
        huntResponse: huntData,
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Hunt API integration working!',
      huntApplicationId: huntData.id,
      huntResponse: huntData,
    });
    
  } catch (error) {
    console.error('Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
}
