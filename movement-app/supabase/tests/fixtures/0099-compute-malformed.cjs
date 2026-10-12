'use strict';
process.on('message',()=>{process.send({state:'ready',geometry:'private'},()=>process.exit(0));});
