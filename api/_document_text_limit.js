'use strict';
// Direct HTML read limit only. Evidence Package acquisition extracts and scores
// source content through _content_search and uses independent output budgets.
const MAX_HTML_TEXT_CHARACTERS=120000;
function boundedHtmlText(value){
 if(typeof value!=='string')throw new TypeError('Extracted HTML text must be a string');
 return {text:value.slice(0,MAX_HTML_TEXT_CHARACTERS),
  truncated:value.length>MAX_HTML_TEXT_CHARACTERS,
  extraction:'html-text'};
}
module.exports={MAX_HTML_TEXT_CHARACTERS,boundedHtmlText};
