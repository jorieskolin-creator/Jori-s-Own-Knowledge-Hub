'use strict';

function isPersonalPath(pathname){
 return typeof pathname==='string'&&/^06-personal(?:\/|$)/i.test(pathname);
}

module.exports={isPersonalPath};
