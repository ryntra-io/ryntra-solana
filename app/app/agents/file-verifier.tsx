"use client";

import { Page } from "@ryntra/core/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ACTION_PASSPORT_HANDOFF_KEY, verifyArtifact } from "@/app/agents/agent-control-client";
import type { ArtifactVerificationView } from "@/app/agents/types";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import styles from "./agents.module.css";

const MAX_BYTES=128*1024;
export function FileVerifier() {
  const {locale}=useSolanaI18n(); const uk=locale==="uk";
  const [source,setSource]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[result,setResult]=useState<ArtifactVerificationView|null>(null);
  const request=useRef<AbortController|null>(null);
  const change=(value:string)=>{request.current?.abort();request.current=null;setSource(value);setError(null);setResult(null);setBusy(false);};
  useEffect(()=>{if(new URLSearchParams(window.location.search).get("handoff")==="1"){try{const saved=window.sessionStorage.getItem(ACTION_PASSPORT_HANDOFF_KEY);if(saved&&new TextEncoder().encode(saved).length<=MAX_BYTES)setSource(saved);}catch{}}return()=>request.current?.abort();},[]);
  async function verify(){
    request.current?.abort();setError(null);setResult(null);
    if(new TextEncoder().encode(source).length>MAX_BYTES){setError(uk?"Файл завеликий. Максимум 128 КБ.":"File is too large. Maximum 128 KB.");return;}
    let parsed:unknown;try{parsed=JSON.parse(source);}catch{setError(uk?"Перевір формат JSON":"Check the JSON format");return;}
    const controller=new AbortController();request.current=controller;setBusy(true);
    try{const next=await verifyArtifact(parsed,controller.signal);if(request.current===controller)setResult(next);}catch{if(request.current===controller&&!controller.signal.aborted)setError(uk?"Перевірка недоступна. Спробуй ще раз.":"Verification is unavailable. Try again.");}finally{if(request.current===controller)setBusy(false);}
  }
  const yes=uk?"Підтверджено":"Confirmed",no=uk?"Не підтверджено":"Not confirmed",na=uk?"Не стосується":"Not applicable";
  /* A form: the core's action column in the middle of the canvas, the way back above it (SOL-C19). */
  return <Page kind="action" className={styles.actionPage} title={uk?"Перевірити файл":"Verify a file"} lang={uk?"uk":"en"}>
    <Link className={styles.back} href="/app/agents">← {uk?"До агентів":"Back to agents"}</Link>
    <form className={styles.form} onSubmit={e=>{e.preventDefault();void verify();}}>
      <label htmlFor="artifact-file">{uk?"Файл JSON":"JSON file"}</label><input id="artifact-file" type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>MAX_BYTES){setError(uk?"Файл завеликий. Максимум 128 КБ.":"File is too large. Maximum 128 KB.");return;}change(await file.text());}}/>
      <label htmlFor="artifact-content">{uk?"Вміст файлу":"File contents"}</label><textarea id="artifact-content" value={source} onChange={e=>change(e.target.value)} rows={7} spellCheck={false}/>
      <div><button className="rw-btn rw-btn--primary" disabled={busy||!source.trim()} type="submit">{busy?(uk?"Перевірка…":"Checking…"):(uk?"Перевірити":"Verify")}</button><button className="rw-btn" disabled={!source} type="button" onClick={()=>change("")}>{uk?"Очистити":"Clear"}</button></div>
    </form>
    {error?<p className={styles.notice} role="alert">{error}</p>:null}
    {result?<section className={styles.record} aria-label={uk?"Результат перевірки":"Verification result"}><h2>{uk?"Результат":"Result"}</h2><dl className={styles.facts}>
      <div><dt>{uk?"Формат":"Format"}</dt><dd>{result.recognised?(uk?"Розпізнано":"Recognised"):(uk?"Невідомий":"Unknown")}</dd></div>
      <div><dt>{uk?"Цілісність":"Integrity"}</dt><dd>{result.integrity.valid?yes:no}</dd></div>
      <div><dt>{uk?"Підпис":"Signature"}</dt><dd>{result.issuer.verdict==="SIGNATURE_VALID"?yes:result.issuer.verdict==="UNSIGNED"?(uk?"Без підпису":"Unsigned"):no}</dd></div>
      <div><dt>{uk?"Погодження":"Authorization"}</dt><dd>{result.authorization.verdict==="AUTHORIZED"?yes:result.authorization.verdict==="NOT_APPLICABLE"?na:no}</dd></div>
      <div><dt>{uk?"Спостереження результату":"Outcome observation"}</dt><dd>{result.observation.verdict==="OBSERVED"?yes:result.observation.verdict==="NOT_APPLICABLE"?na:no}</dd></div>
    </dl></section>:null}
  </Page>;
}
