'use strict';
process.on('message',()=>{process.stderr.write('not-a-metric-record\n');while(true){}});
