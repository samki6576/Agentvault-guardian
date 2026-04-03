// webllm-worker.js — WebLLM / OpenClaw worker stub
// Replace with actual WebLLM package: https://github.com/mlc-ai/web-llm
// Or OpenClaw: https://github.com/openclaw/openclaw
//
// To use real WebLLM:
//   npm install @mlc-ai/web-llm
//   Copy the built worker + wasm files into this directory
//   Update this file to re-export CreateMLCEngine from the real package

export async function CreateMLCEngine(modelId, options = {}) {
  console.log(`[WebLLM Stub] Simulating model load: ${modelId}`);

  if (options.initProgressCallback) {
    // Simulate progress callbacks
    for (let i = 0; i <= 10; i++) {
      await new Promise(r => setTimeout(r, 50));
      options.initProgressCallback({ progress: i / 10, text: `Loading ${modelId}...` });
    }
  }

  // Mock inference engine — returns plausible structured JSON for demo
  return {
    chat: {
      completions: {
        create: async ({ messages }) => {
          const userMsg = messages.find(m => m.role === 'user')?.content || '';
          const isTravel   = userMsg.toLowerCase().includes('flight') || userMsg.toLowerCase().includes('hotel');
          const isCalendar = userMsg.toLowerCase().includes('calendar') || userMsg.toLowerCase().includes('conflict');
          const isReport   = userMsg.toLowerCase().includes('synthesize');

          let responseJson;
          if (isTravel) {
            responseJson = {
              intent:  'search_travel',
              apiCall: 'travel:search',
              params:  { destination: 'Tokyo', departure: 'SFO', checkin: '2026-05-01', checkout: '2026-05-07', adults: 1 }
            };
          } else if (isCalendar) {
            responseJson = {
              intent:  'check_calendar',
              apiCall: 'calendar:read',
              params:  { timeMin: '2026-05-01T00:00:00Z', timeMax: '2026-05-07T23:59:59Z', maxResults: 10 }
            };
          } else if (isReport) {
            responseJson = {
              intent:  'generate_report',
              apiCall: 'local:report',
              params:  { format: 'markdown', sections: ['flights', 'hotels', 'activities', 'calendar'] }
            };
          } else {
            responseJson = {
              intent:  'generic_task',
              apiCall: 'travel:search',
              params:  { query: userMsg.slice(0, 100) }
            };
          }

          return {
            choices: [{
              message: {
                role:    'assistant',
                content: JSON.stringify(responseJson)
              },
              finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 }
          };
        }
      }
    }
  };
}
