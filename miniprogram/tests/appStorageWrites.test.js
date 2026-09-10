const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  const storage = new Map(), writes = []; let app, resumes = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), {
    App: value => { app = value; }, console,
    wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => {storage.set(key,value); writes.push(key);} },
    require: () => ({ resumeDiagnosticUploads: () => resumes++ })
  });
  return {app,storage,writes,resumes:()=>resumes};
}
test('unchanged user validation performs no writes but still updates authentication immediately', () => {
  const h=setup(), user={id:7,role:'user',nickname:'name',avatar_url:'avatar'};
  h.app.applyCurrentUser(user,'token');
  assert.equal(h.writes.length,7); h.writes.length=0;
  h.app.applyCurrentUser(user,'token');
  assert.equal(h.writes.length,0);
  assert.equal(h.app.globalData.isAuthenticated,true);
  assert.equal(h.app.globalData.sessionValidated,true);
  assert.equal(h.resumes(),2);
  h.app.applyCurrentUser({...user,nickname:'changed'});
  assert.deepEqual(h.writes,['userNickname']);
});
test('account and permission changes persist immediately', () => {
  const h=setup(); h.app.applyCurrentUser({id:7,role:'user'},'first');
  h.writes.length=0;
  h.app.applyCurrentUser({id:8,role:'guest'},'second');
  assert.equal(h.storage.get('userId'),'8');
  assert.equal(h.storage.get('accessToken'),'second');
  assert.equal(h.storage.get('isAuthenticated'),false);
  assert.equal(h.app.globalData.isAuthenticated,false);
  h.writes.length=0; h.app.setAuthState('guest',false);
  assert.equal(h.writes.length,0);
});
