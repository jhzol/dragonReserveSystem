// Integration bridge: real client recorder/logger/outbox; wx HTTP is driven by FastAPI TestClient.
const fs = require('node:fs');
const vm = require('node:vm');
const readline = require('node:readline');
const { createHomePresentationDiagnostics } = require('../../utils/homePresentationDiagnostics');
const { createDiagnosticOutbox, STORAGE_KEY } = require('../../services/diagnosticOutbox');
const [mode, storagePath] = process.argv.slice(2);
let stored = fs.existsSync(storagePath) ? JSON.parse(fs.readFileSync(storagePath, 'utf8')) : [];
let timers = [], requests = [];
const wx = {
  getStorageSync: key => key === STORAGE_KEY ? stored : key === 'userId' ? 'integration-user' : key === 'accessToken' ? 'integration-token' : '',
  setStorageSync: (key, value) => { if (key === STORAGE_KEY) { stored = structuredClone(value); fs.writeFileSync(storagePath, JSON.stringify(stored)); } },
  request: req => requests.push(req), onNetworkStatusChange() {}
};
const sandbox = { module:{exports:{}}, wx, console:{info(){},error(){}}, setTimeout, clearTimeout,
  getCurrentPages:()=>[{route:'pages/activity_list/activity_list'}],
  require: name => name === './config' ? {getApiBaseUrl:()=> 'http://127.0.0.1/api/v1'} : {
    createDiagnosticOutbox: opts => createDiagnosticOutbox({...opts, setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer(){}})
  }
};
vm.runInNewContext(fs.readFileSync(require.resolve('../../services/logger'),'utf8'), sandbox);
const logger = sandbox.module.exports;
if (mode === 'seed') {
  for (const scenario of ['list_missing','cover_missing','glass_missing']) {
    const page={data:{homeListLoading:scenario === 'list_missing',focusedCardIndex:{joined:0},groupedActivities:{joined:scenario === 'list_missing' ? [] : [
      {_id:'42',largeCardBgImageUrl:'https://cdn.test/cover?token=private',largeCardGlassImageUrl:'https://cdn.test/glass',_homeMediaReady:false},
      {_id:'43',largeCardBgImageUrl:'https://cdn.test/other',largeCardGlassImageUrl:'https://cdn.test/other-glass',_homeMediaReady:true}
    ]}},_homeReadyImages:new Map(),getTabBar:()=>({data:{hidden:false}})};
    let elapsed = 0;
    page._homeReadyImages.set('https://cdn.test/other', 'local');
    page._homeReadyImages.set('https://cdn.test/other-glass', 'local');
    const recorder=createHomePresentationDiagnostics({page,wxApi:{},now:()=>elapsed,traceId:`integration-${scenario}`,setTimer:()=>0,clearTimer(){},
      emit:(event,payload)=>{ if(payload.reason === 'checkpoint_15000') logger.logInfo(event,payload); }});
    recorder.list(scenario === 'list_missing' ? 'request_pending' : 'list_processed');
    if(scenario === 'cover_missing') page._homeReadyImages.set('https://cdn.test/glass','local');
    if(scenario === 'glass_missing') page._homeReadyImages.set('https://cdn.test/cover?token=private','local');
    elapsed = 100;
    recorder.phase("https://cdn.test/cover?token=private", "download_started", { priority: 0, startPriority: 1 });
    elapsed = 230;
    recorder.phase("https://cdn.test/cover?token=private", "download_progress", {bytes: 12345, expectedBytes: 900000});
    recorder.phase("https://cdn.test/glass", "image_info_complete", {width: 1200, height: 1400});
    elapsed = 15000;
    recorder.snapshot('checkpoint_15000'); recorder.stop();
  }
  logger.logInfo('home_media_attempt', {traceId:'integration-attempt', sequence:1, stage:'attempt_failed',
    evidence:{attempt:2, bytes:540672, logicalActive:3, outstandingPreparations:5,
      profile:{profileAvailable:true, queueStart:1,queueEnd:32,connectStart:33,connectEnd:48,protocol:'h2'},
      requestId:'hm-integration-2', downloadTasksAwaitingCallback:4}});
  timers.splice(0).forEach(fn=>fn());
  requests[0].fail({errMsg:'injected offline'});
  console.log(JSON.stringify({retained:stored.length,ids:stored.map(e=>e.id)}));
} else {
  const lines=readline.createInterface({input:process.stdin});
  logger.resumeDiagnosticUploads(); timers.splice(0).forEach(fn=>fn());
  console.log(JSON.stringify({request:requests[0].data}));
  lines.once('line',line=>{
    requests[0].success(JSON.parse(line));
    console.log(JSON.stringify({retained:stored.length})); lines.close();
  });
}
