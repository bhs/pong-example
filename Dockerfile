FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Copy source files
COPY . .

# Default command serves the static files; tests override this via exec
CMD ["node", "-e", "const http=require('http'),fs=require('fs'),path=require('path'); const MIME={'html':'text/html','js':'application/javascript','css':'text/css'}; http.createServer((req,res)=>{const rel=req.url==='/'?'index.html':req.url.replace(/^\//,''); const f=path.join('/app',rel); const ext=path.extname(f).slice(1)||'html'; fs.access(f,fs.constants.R_OK,(err)=>{if(err){const idx=path.join('/app','index.html');res.writeHead(200,{'Content-Type':'text/html'});fs.createReadStream(idx).pipe(res);}else{res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});fs.createReadStream(f).pipe(res);}})}).listen(3000,()=>console.log('Serving on :3000'))"]
