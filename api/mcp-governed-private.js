'use strict';
// Dedicated Private evidence-only MCP endpoint. A scoped OAuth audience is mandatory.
const handler=require('./mcp-private');
module.exports=(req,res)=>handler(req,res,{governedEvidenceOnly:true});
