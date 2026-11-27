(function(root){
  "use strict";
  function link(xin){return /^\d{12}$/.test(String(xin))?"https://stoldom.site/#kgd="+xin:null;}
  function qrCanvas(xin,scale=4){
    const url=link(xin);if(!url)throw Error("БИН / ИИН не указан.");
    if(typeof root.qrcode!=="function")throw Error("Модуль QR-кода не загрузился.");
    const qr=root.qrcode(0,"M");qr.addData(url,"Byte");qr.make();
    const n=qr.getModuleCount(),c=document.createElement("canvas");c.width=c.height=(n+8)*scale;
    const ctx=c.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="#101820";
    for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(qr.isDark(row,col))ctx.fillRect((col+4)*scale,(row+4)*scale,scale,scale);
    return c;
  }
  async function logoCanvas(){
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error("Не удалось загрузить логотип STOLDOM."));image.src="/stoldom-people-logo.webp?v=7";});
    const c=document.createElement("canvas");c.width=c.height=240;
    const ctx=c.getContext("2d");const k=Math.min(240/image.naturalWidth,240/image.naturalHeight),w=image.naturalWidth*k,h=image.naturalHeight*k;
    ctx.drawImage(image,(240-w)/2,(240-h)/2,w,h);return c;
  }
  async function png(canvas){
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("Не удалось подготовить изображение.")),"image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }
  root.KgdBrand={link,qrCanvas,logoCanvas,png};
})(globalThis);
