"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {issue,valid,TTL}=require("../kgd-session");
test("session is valid for 30 days; secret rotation and tampering invalidate it",()=>{
 const key="test-key-not-for-production-12345", now=Date.now();
 const {session,expiresAt}=issue(key,now);
 assert.equal(expiresAt,now+TTL);
 assert.equal(valid(key,session,now),true);
 assert.equal(valid(key,session,expiresAt-1),true);
 assert.equal(valid(key,session,expiresAt),false);
 assert.equal(valid("other-test-key-12345678901234",session,now),false);
 assert.equal(valid(key,session.slice(0,-1)+(session.endsWith("a")?"b":"a"),now),false);
 assert.equal(valid(key,"invalid",now),false);
});
