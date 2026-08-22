FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Copy source files
COPY . .

# Default command serves the static file; tests override this via exec
CMD ["node", "-e", "const http=require('http'),fs=require('fs'),path=require('path'); http.createServer((req,res)=>{const f=path.join('/app','index.html');res.writeHead(200,{'Content-Type':'text/html'});fs.createReadStream(f).pipe(res)}).listen(3000,()=>console.log('Serving on :3000'))"]
