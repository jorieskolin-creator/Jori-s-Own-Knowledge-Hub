'use strict';
// Dedicated Public evidence-only MCP endpoint. Full document reads remain on /api/mcp.
const handler=require('./mcp');
module.exports=(req,res)=>handler(req,res,{governedEvidenceOnly:true});
