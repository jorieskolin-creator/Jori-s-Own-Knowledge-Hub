'use strict';
const CONTACT=/(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[\p{L}\p{N}-]+\.(?:com|org|net|fi|io|cloud|onmicrosoft\.com)\b)/iu;
const SECRETS=/(?:\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|eyJ[\w-]{20,}|AKIA[A-Z0-9]{16})\b|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:api.?key|password|secret|token|salasana)\s*[:=]\s*\S{4,})/iu;
const IDENTIFIER=/(?:\+\d[\d ().-]{7,}\d|\b\d{9,}\b|\b\d{6}[+A-]\d{3}[0-9A-Z]\b|\b[A-Z]{2}\d{2}[A-Z0-9]{12,}\b)/u;
const ENTITY_PAIR=/(?<![\p{L}\p{N}_])\p{Lu}\p{Ll}{1,}(?:[’'-]\p{Lu}?\p{Ll}+)?[ \t]+\p{Lu}\p{Ll}{1,}(?![\p{L}\p{N}_])/gu;
const ENTITY_SUFFIX=/(?:^|\W)[\p{L}\p{N}._-]+\s+(?:oyj?|abp?|ltd|inc|llc|corp|gmbh|plc)\b/iu;
const PROPER_WORD=/(?<![\p{L}\p{N}_])(?:[\p{Lu}][\p{Ll}]{2,}|[\p{Ll}]+[\p{Lu}][\p{L}]+|[\p{Lu}]{3,})(?![\p{L}\p{N}_])/gu;
const SAFE_WORDS=new Set('AI API CO2 CSCF CSV DOCX EU EUC GDPR HTML ICT IT JSON KPI LLM LZ MCP OCR PDF PII PR RFP SaaS SecOps SRE TTL URL UX FinOps GenAI DevOps Knowledge Hub Generate Ground Govern Level Landing Zone Public Private Word Helsinki Shaping Demand Validated Proposal Signal Agentic Flow Evolving Modernization Concept Value Creation Flywheel'.split(' '));
const FRAMEWORK_PREFIXES=new Set(['At','For','From','In','To','With']);
const SOURCE_POINTER=/(?:\b(?:public|private):|(?:^|\s)[\w.%/-]+\.(?:pdf|html?|docx)\b|\b06-personal\b)/iu;
const RECONSTRUCTION=/(?:\b(?:verbatim|word.for.word|entire (?:file|document|source)|full (?:file|document|text|source)|(?:next|previous) (?:page|paragraph|section)|(?:reproduce|transcribe|copy|dump) (?:the |that |this )?(?:file|document|source|text|section))\b|\b(?:sanasta sanaan|koko asiakirja|koko dokumentti|seuraava sivu)\b)/iu;
const OVERRIDE=/(?:ignore|override|reveal|disregard|ohita|paljasta)\s+(?:all |the |your |aiemmat )?(?:previous instructions|system prompt|developer instructions|safety rules|aiemmat ohjeet|järjestelmäohjeet)/iu;
class ChatPolicy extends Error{
  constructor(reason){super('This request or answer could not be released under the Chat rules');this.reason=reason;}
}
function normalized(text){
  return text.normalize('NFKC').replace(/[\p{Cf}\p{Cc}]/gu,char=>/^[\n\r\t]$/.test(char)?char:'');
}
function deniedTerms(){
  const configured=process.env.CHAT_DENIED_TERMS||'';
  const entries=configured.split('\n').map(value=>normalized(value.trim()).toLowerCase()).filter(Boolean);
  if(entries.length>500||entries.some(value=>value.length>100))throw Error('Invalid Chat privacy configuration');
  return entries;
}
function explicitIdentifier(text,terms=deniedTerms()){
  const value=normalized(text);
  const lower=value.toLowerCase();
  return CONTACT.test(value)||SOURCE_POINTER.test(value)||SECRETS.test(value)||IDENTIFIER.test(value)||ENTITY_SUFFIX.test(value)||
    terms.some(term=>lower.includes(term))||
    [...value.matchAll(ENTITY_PAIR)].some(match=>{
      const [first,second]=match[0].split(/\s+/);
      return !SAFE_WORDS.has(second)||(!SAFE_WORDS.has(first)&&!FRAMEWORK_PREFIXES.has(first));
    });
}
function ambiguousName(text){
  const value=normalized(text);
  return [...value.matchAll(PROPER_WORD)].some(match=>{
    if(SAFE_WORDS.has(match[0]))return false;
    if(/[\p{Lu}]/u.test(match[0].slice(1)))return true;
    const previous=value.slice(0,match.index).trimEnd().at(-1);
    return previous!==undefined&&!/[.!?]/.test(previous)&&!/\n\s*$/u.test(value.slice(0,match.index));
  });
}
function screenQuestion(question,format){
  if(typeof question!=='string'||question.trim().length<2||question.length>1200||
    !['chat','word'].includes(format))throw RangeError('Enter a question of 2 to 1,200 characters');
  const value=normalized(question).trim();
  if(value.length<2||explicitIdentifier(value)||ambiguousName(value)||RECONSTRUCTION.test(value)||OVERRIDE.test(value))
    throw new ChatPolicy();
  return value;
}
function screenPassages(passages){
  return passages.flatMap(p=>{
    const text=normalized(p.text).trim();
    if(!text||explicitIdentifier(text)||ambiguousName(text)||OVERRIDE.test(text))return [];
    return [{...p,text:text.slice(0,1200)}];
  });
}
function screenAnswer(text){
  const value=normalized(text);
  if(explicitIdentifier(value)||ambiguousName(value)||OVERRIDE.test(value)||/[<>]/.test(value))throw new ChatPolicy('answer_identifier');
  return value;
}
module.exports={ChatPolicy,screenQuestion,screenPassages,screenAnswer};
