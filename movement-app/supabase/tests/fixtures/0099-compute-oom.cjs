'use strict';
process.on('message',()=>{const arrays=[];while(true)arrays.push(new Array(100000).fill('fixture'));});
