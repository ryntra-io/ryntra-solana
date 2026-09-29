import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { applyThemePref, getThemePref, readResolvedTheme, THEME_BOOT_SCRIPT } from "./theme.ts";

function withBrowser(storage, run) {
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  const attributes=new Map();
  const element={style:{},setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key)??null};
  globalThis.window={localStorage:storage,matchMedia:()=>({matches:true})};
  globalThis.document={documentElement:element};
  try { run(element); } finally {
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
}

test("theme changes both token systems and retains the choice",()=>{
  const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  withBrowser(storage,element=>{
    for(const theme of ["light","dark","light"]){applyThemePref(theme);assert.equal(readResolvedTheme(),theme);assert.equal(getThemePref(),theme);assert.equal(element.getAttribute("data-ry-theme"),theme);assert.equal(element.style.colorScheme,theme);}
    assert.equal(values.get("ryntra-theme-pref"),"light");assert.equal(values.get("ryntra-demo-theme"),"light");
  });
});

test("denied browser storage cannot trap the switch in one theme",()=>{
  const denied={getItem(){throw new Error("Storage denied");},setItem(){throw new Error("Storage denied");}};
  withBrowser(denied,()=>{
    assert.doesNotThrow(()=>applyThemePref("light"));assert.equal(getThemePref(),"light");
    assert.doesNotThrow(()=>applyThemePref("dark"));assert.equal(getThemePref(),"dark");
    Object.defineProperty(globalThis.window,"localStorage",{get(){throw new Error("Storage denied");}});
    assert.doesNotThrow(()=>applyThemePref("light"));assert.equal(getThemePref(),"light");
  });
});

test("first paint always initializes a theme, including blocked storage",()=>{
  const denied={getItem(){throw new Error("Storage denied");},setItem(){throw new Error("Storage denied");}};
  withBrowser(denied,element=>{
    vm.runInNewContext(THEME_BOOT_SCRIPT,{localStorage:denied,document:globalThis.document});
    assert.equal(element.getAttribute("data-theme"),"dark");assert.equal(element.style.colorScheme,"dark");
    applyThemePref("light");vm.runInNewContext(THEME_BOOT_SCRIPT,{localStorage:denied,document:globalThis.document});assert.equal(element.getAttribute("data-theme"),"light","Entering another layout must retain the visible choice when storage is blocked");
  });
  const system={getItem:()=>"system",setItem(){throw new Error("Read only");}};
  withBrowser(system,element=>{
    vm.runInNewContext(THEME_BOOT_SCRIPT,{localStorage:system,document:globalThis.document,matchMedia:()=>({matches:true})});
    assert.equal(element.getAttribute("data-theme"),"light");assert.equal(getThemePref(),"light");
  });
});
