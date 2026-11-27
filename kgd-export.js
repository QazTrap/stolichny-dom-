(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.KgdExport=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const TITLE="Сведения по контрагенту";
  const SOURCE="Источник: КГД МФ РК — открытые данные";
  const STATS=["Год","Работники","Налоги, ₸","КНН","Средний КНН","НДС, ₸"];
  const statKeys=["year","workersCount","taxIn","knn","knnAvg","vatAmount"];
  const text=v=>v===null||v===undefined||v===""?"Нет данных":typeof v==="object"?String(v.ru||v.kk||"Нет данных"):String(v);
  const enc=new TextEncoder();
  function report(d,fields,now=new Date()){
    const rows=[["Наименование",text(d.name)]];
    for(const [key,label] of fields){
      if(Object.hasOwn(d,key))rows.push([label,text(d[key])+(key==="taxDebt"&&typeof d[key]==="number"?" ₸":"")]);
    }
    for(const key of ["taxDebt1","taxDebt2","taxDebt3","taxDebt4"]){
      if(Object.hasOwn(d,key))rows.push(["Показатель КГД "+key,text(d[key])]);
    }
    const statistics=Array.isArray(d.statistics)?d.statistics.map(r=>statKeys.map(k=>typeof r[k]==="number"?r[k]:text(r[k]))):[];
    return {rows,statistics,xin:String(d.xin||""),date:now.toLocaleString("ru-RU",{timeZone:"Asia/Almaty"}),filename:"STOLDOM_КГД_"+(/^\d{12}$/.test(String(d.xin))?d.xin:"контрагент")+"_"+now.toISOString().slice(0,10)};
  }
  function save(bytes,mime,name){
    const blob=new Blob([bytes],{type:mime}),url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function excel(r){
    const X=globalThis.XLSX;if(!X)throw Error("Библиотека Excel не загрузилась. Обновите страницу.");
    const wb=X.utils.book_new();
    const ws=X.utils.aoa_to_sheet([[TITLE],["STOLDOM.SITE"],[SOURCE],["Дата формирования",r.date],[],["Показатель","Значение"],...r.rows]);
    ws["!cols"]=[{wch:43},{wch:85}];ws["!autofilter"]={ref:"A6:B"+(6+r.rows.length)};
    X.utils.book_append_sheet(wb,ws,"Карточка КГД");
    if(r.statistics.length){const st=X.utils.aoa_to_sheet([STATS,...r.statistics]);st["!cols"]=STATS.map(()=>({wch:20}));X.utils.book_append_sheet(wb,st,"Статистика");}
    X.writeFile(wb,r.filename+".xlsx",{compression:true});
  }
  function esc(v){return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));}
  function paragraph(t,{bold=false,size=22,color="17233A"}={}){
    return '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'+(bold?"<w:b/>":"")+'<w:color w:val="'+color+'"/><w:sz w:val="'+size+'"/></w:rPr><w:t xml:space="preserve">'+esc(t)+'</w:t></w:r></w:p>';
  }
  function table(rows,widths){
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+["top","left","bottom","right","insideH","insideV"].map(k=>'<w:'+k+' w:val="single" w:sz="4" w:color="D4DBE4"/>').join("")+'</w:tblBorders></w:tblPr><w:tblGrid>'+widths.map(w=>'<w:gridCol w:w="'+w+'"/>').join("")+'</w:tblGrid>'+rows.map((row,i)=>'<w:tr><w:trPr>'+(i===0?"<w:tblHeader/>":"")+'<w:cantSplit/></w:trPr>'+row.map((cell,j)=>'<w:tc><w:tcPr><w:tcW w:w="'+widths[j]+'" w:type="dxa"/>'+(i===0?'<w:shd w:fill="E7EDF5"/>':"")+'</w:tcPr>'+paragraph(cell,{bold:i===0,size:20})+'</w:tc>').join("")+'</w:tr>').join("")+'</w:tbl>';
  }
  function concat(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;}
  const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(data){let crc=0xffffffff;for(const b of data)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function zip(files){
    const local=[],central=[];let offset=0;
    for(const [name,contents] of Object.entries(files)){
      const n=enc.encode(name),data=typeof contents==="string"?enc.encode(contents):contents,crc=crc32(data);
      const l=new Uint8Array(30+n.length),lv=new DataView(l.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,n.length,true);l.set(n,30);
      const c=new Uint8Array(46+n.length),cv=new DataView(c.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true);c.set(n,46);
      local.push(l,data);central.push(c);offset+=l.length+data.length;
    }
    const directory=concat(central),end=new Uint8Array(22),ev=new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(8,central.length,true);ev.setUint16(10,central.length,true);ev.setUint32(12,directory.length,true);ev.setUint32(16,offset,true);
    return concat([...local,directory,end]);
  }
  function imageParagraph(id,name,cx,cy){
    return '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+id+'" name="'+esc(name)+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+id+'" name="'+esc(name)+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId'+id+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  function docx(r,images){
    const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const body=(images?imageParagraph(1,"STOLDOM",550000,550000):"")+paragraph("STOLDOM.SITE",{bold:true,size:22,color:"315D91"})+paragraph(TITLE,{bold:true,size:34})+paragraph(SOURCE)+paragraph("Дата формирования: "+r.date)+table([["Показатель","Значение"],...r.rows],[3300,5700])+(r.statistics.length?paragraph("Статистика по годам",{bold:true,size:26})+table([STATS,...r.statistics],[1000,1300,1900,1200,1500,2100]):"")+(images?.qr?imageParagraph(2,"QR",1200000,1200000)+paragraph("Открыть карточку контрагента",{size:18}):"");
    return zip({
      "[Content_Types].xml":xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ...(images?{"word/media/logo.png":images.logo,...(images.qr?{"word/media/qr.png":images.qr}:{}),"word/_rels/document.xml.rels":xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>'+(images.qr?'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/qr.png"/>':'')+'</Relationships>'}:{}),
      "word/document.xml":xml+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1200" w:bottom="1200" w:left="1200"/></w:sectPr></w:body></w:document>'
    });
  }
  // Rasterize text with installed browser fonts, including Cyrillic and Kazakh.
  // A4 PDF pages use real JPEG image XObjects, not a renamed HTML document.
  function imagePdf(pages,width,height){
    const parts=[],offsets=[0];let offset=0;
    const put=x=>{const a=typeof x==="string"?enc.encode(x):x;parts.push(a);offset+=a.length;};
    function obj(n,contents){offsets[n]=offset;put(n+" 0 obj\n");for(const x of contents)put(x);put("\nendobj\n");}
    put("%PDF-1.4\n");
    obj(1,["<< /Type /Catalog /Pages 2 0 R >>"]);
    obj(2,["<< /Type /Pages /Count "+pages.length+" /Kids ["+pages.map((_,i)=>(3+i*3)+" 0 R").join(" ")+"] >>"]);
    pages.forEach((jpeg,i)=>{
      const p=3+i*3,img=p+1,c=p+2;
      obj(p,["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 "+img+" 0 R >> >> /Contents "+c+" 0 R >>"]);
      obj(img,["<< /Type /XObject /Subtype /Image /Width "+width+" /Height "+height+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+jpeg.length+" >>\nstream\n",jpeg,"\nendstream"]);
      const stream="q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";
      obj(c,["<< /Length "+enc.encode(stream).length+" >>\nstream\n"+stream+"endstream"]);
    });
    const xref=offset;
    put("xref\n0 "+offsets.length+"\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size "+offsets.length+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n");
    return concat(parts);
  }
  async function pdf(r){
    const W=1240,H=1754,M=86,RIGHT=W-M,BOTTOM=H-105,LH=26;
    const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)throw Error("Не удалось подготовить PDF.");
    const logo=await globalThis.KgdBrand.logoCanvas(),qr=globalThis.KgdBrand.link(r.xin)?globalThis.KgdBrand.qrCanvas(r.xin,6):null;
    const pages=[];let y,page=0;
    function font(size,bold=false){ctx.font=(bold?"bold ":"")+size+"px Arial, sans-serif";}
    function draw(t,x,yy,size=23,bold=false,color="#17233a"){font(size,bold);ctx.fillStyle=color;ctx.fillText(String(t),x,yy);}
    function wrap(t,max,size=23,bold=false){
      font(size,bold);const lines=[];
      for(const para of String(t).split(/\r?\n/)){
        let line="";
        for(const word of para.split(/\s+/)){
          const next=line?line+" "+word:word;
          if(ctx.measureText(next).width<=max){line=next;continue;}
          if(line){lines.push(line);line="";}
          for(const char of word){if(line&&ctx.measureText(line+char).width>max){lines.push(line);line="";}line+=char;}
        }
        lines.push(line);
      }
      return lines.length?lines:[""];
    }
    function start(){
      page++;ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
      ctx.drawImage(logo,M,48,60,60);draw("STOLDOM.SITE",M+74,92,24,true,"#315d91");draw(TITLE,M,150,40,true);
      draw(SOURCE,M,191,22,false,"#526174");draw("Дата формирования: "+r.date,M,225,20,false,"#526174");
      ctx.fillStyle="#315d91";ctx.fillRect(M,249,RIGHT-M,3);y=282;
    }
    async function finish(){
      ctx.fillStyle="#d4dbe4";ctx.fillRect(M,H-82,RIGHT-M,2);draw("STOLDOM.SITE  •  Сведения КГД",M,H-48,20,false,"#526174");draw("Стр. "+page,RIGHT-105,H-48,20,false,"#526174");
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("Не удалось создать PDF.")),"image/jpeg",0.94));
      pages.push(new Uint8Array(await blob.arrayBuffer()));
    }
    async function row(label,value){
      const split=M+398,labels=wrap(label,365,21),values=wrap(value,RIGHT-split-24,22,true);
      const total=Math.max(labels.length,values.length);
      if(total*LH+12<=BOTTOM-282&&y+total*LH+12>BOTTOM){await finish();start();}
      let pos=0;
      while(pos<total){
        let n=Math.floor((BOTTOM-y-12)/LH);
        if(n<1){await finish();start();n=Math.floor((BOTTOM-y-12)/LH);}
        const take=Math.min(total-pos,n),height=take*LH+12;
        ctx.fillStyle="#f1f4f8";ctx.fillRect(M,y,398,height);
        ctx.strokeStyle="#d4dbe4";ctx.lineWidth=1;ctx.strokeRect(M,y,RIGHT-M,height);
        for(let i=0;i<take;i++){if(labels[pos+i]!==undefined)draw(labels[pos+i],M+12,y+24+i*LH,21,false,"#526174");if(values[pos+i]!==undefined)draw(values[pos+i],split+12,y+24+i*LH,22,true);}
        y+=height;pos+=take;
      }
    }
    start();
    await row("Показатель","Значение");
    for(const [label,value] of r.rows)await row(label,value);
    if(r.statistics.length){
      const widths=[100,150,245,130,180,263],labels=["Год","Работники","Налоги, ₸","КНН","Средний КНН","НДС, ₸"];
      const fmt=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
      const header=()=>{
        y+=32;draw("Статистика по годам",M,y,28,true);y+=17;
        ctx.fillStyle="#e7edf5";ctx.fillRect(M,y,RIGHT-M,42);
        let x=M;
        labels.forEach((label,i)=>{draw(label,x+10,y+27,18,true,"#526174");x+=widths[i];});
        y+=42;
      };
      if(y+140>BOTTOM){await finish();start();}
      header();
      for(const [i,data] of r.statistics.entries()){
        if(y+42>BOTTOM){await finish();start();header();}
        if(i%2===0){ctx.fillStyle="#f5f8fc";ctx.fillRect(M,y,RIGHT-M,42);}
        let x=M;
        data.forEach((value,j)=>{
          const str=typeof value==="number"&&j!==0?fmt.format(value):String(value);
          let size=21;font(size,true);
          while(size>13&&ctx.measureText(str).width>widths[j]-18){size--;font(size,true);}
          draw(str,x+10,y+28,size,true);x+=widths[j];
        });
        ctx.fillStyle="#d4dbe4";ctx.fillRect(M,y+41,RIGHT-M,1);y+=42;
      }
    }
    if(qr){
      if(y+222>BOTTOM){await finish();start();}
      const size=180,center=RIGHT-110,top=y+12;
      ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,center-size/2,top,size,size);ctx.imageSmoothingEnabled=true;
      const caption="Открыть карточку";font(19);draw(caption,center-ctx.measureText(caption).width/2,top+size+20,19,false,"#526174");
    }
    await finish();return imagePdf(pages,W,H);
  }
  async function download(format,d,fields){
    const r=report(d,fields);
    if(format==="xlsx")return excel(r);
    if(format==="docx"){const brand=globalThis.KgdBrand,logo=await brand.png(await brand.logoCanvas()),qr=brand.link(r.xin)?await brand.png(brand.qrCanvas(r.xin,6)):null;return save(docx(r,{logo,qr}),"application/vnd.openxmlformats-officedocument.wordprocessingml.document",r.filename+".docx");}
    if(format==="pdf")return save(await pdf(r),"application/pdf",r.filename+".pdf");
    throw Error("Неизвестный формат.");
  }
  return {report,docx,imagePdf,download};
});
