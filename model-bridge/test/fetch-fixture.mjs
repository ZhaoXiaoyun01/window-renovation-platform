// Offline SDK integration fixture; loaded only by tests through node --import.
import assert from 'node:assert/strict';
globalThis.fetch=async(input,init)=>{
 const request=input instanceof Request?input:new Request(input,init);
 if(request.url==='https://platform.claude.com/v1/oauth/token'){
  assert.equal((await request.json()).grant_type,'refresh_token');
  if(process.env.WINDOW_PI_TEST_FAIL==='1')return new Response('{}',{status:401});
  return Response.json({access_token:'sk-ant-oat01-test-rotated',refresh_token:'test-refresh-rotated',expires_in:3600});
 }
 assert.match(request.url,/^https:\/\/api\.anthropic\.com\/v1\/messages/);
 assert.equal(request.headers.get('authorization'),'Bearer sk-ant-oat01-test-rotated');
 const body=await request.json();
 assert.ok(body.system.length);
 assert.equal(body.messages[0].content.at(-1).text,'fixture question');
 const events=[
  {type:'message_start',message:{id:'test-message',type:'message',role:'assistant',model:body.model,content:[],usage:{input_tokens:10,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'SDK fixture response'}},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:4}},
  {type:'message_stop'},
 ];
 return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
};
