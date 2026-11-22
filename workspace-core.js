/* STOLDOM.SITE: pure bank statement rules, shared by browser and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.STOLDOM_CORE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Some bank exports replace the Kazakh ң with '?' or U+FFFD (те?ге).
  // Correct only this unambiguous currency word; do not alter unrelated '?'
  // or Russian spelling "тенге".
  function fixTengeText(value) {
    return String(value ?? "").replace(/(^|[^\p{L}])те[?\uFFFD□]ге(?=$|[^\p{L}])/giu,
      (match, prefix) => {
        const word=match.slice(prefix.length);
        const fixed=word===word.toUpperCase()?"ТЕҢГЕ":
          /^Т/.test(word)?"Теңге":"теңге";
        return prefix+fixed;
      });
  }
  const norm = value => fixTengeText(value).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  function money(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let s = String(value ?? "").replace(/[\s\u00a0\u202f₸$€]/g, "").trim();
    if (!s) return NaN;
    if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
    s=s.replace(/[^0-9.,+-]/g,"");
    const comma=s.lastIndexOf(","),dot=s.lastIndexOf(".");
    if(comma>=0&&dot>=0){
      const decimal=comma>dot?",":".";
      const thousands=decimal===","?".":",";
      s=s.split(thousands).join("").replace(decimal,".");
    } else if(comma>=0){
      if(/^[-+]?\d{1,3}(?:,\d{3})+$/.test(s))s=s.replace(/,/g,"");
      else s=s.replace(",",".");
    } else if(dot>=0 && /^[-+]?\d{1,3}(?:\.\d{3})+$/.test(s)){
      s=s.replace(/\./g,"");
    }
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  function dateText(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return [String(value.getDate()).padStart(2,"0"), String(value.getMonth()+1).padStart(2,"0"), value.getFullYear()].join(".");
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 1 && value < 100000) {
      const d = new Date(Date.UTC(1899,11,30) + Math.floor(value) * 86400000);
      return [String(d.getUTCDate()).padStart(2,"0"),String(d.getUTCMonth()+1).padStart(2,"0"),d.getUTCFullYear()].join(".");
    }
    const s = String(value ?? "").trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return formatDate(Number(m[3]),Number(m[2]),Number(m[1]));
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return formatDate(Number(m[1]),Number(m[2]),Number(m[3]));
    return "";
  }
  function formatDate(d,m,y) {
    const t = new Date(Date.UTC(y,m-1,d));
    if (y<2000 || y>2100 || t.getUTCDate()!==d || t.getUTCMonth()!==m-1 || t.getUTCFullYear()!==y) return "";
    return [String(d).padStart(2,"0"),String(m).padStart(2,"0"),y].join(".");
  }
  function shortLegalName(value) {
    const name = fixTengeText(value).trim();
    const rules = [
      [/^товарищество\s+с\s+ограниченной\s+ответственностью(?=\s|$)/i,"ТОО"],
      [/^индивидуальный\s+предприниматель(?=\s|$)/i,"ИП"],
      [/^товарищество\s+с\s+дополнительной\s+ответственностью(?=\s|$)/i,"ТДО"],
      [/^акционерное\s+общество(?=\s|$)/i,"АО"],
      [/^общество\s+с\s+ограниченной\s+ответственностью(?=\s|$)/i,"ООО"],
      [/^частное\s+учреждение(?=\s|$)/i,"ЧУ"],
      [/^производственный\s+кооператив(?=\s|$)/i,"ПК"]
    ];
    for (const [re,short] of rules) if (re.test(name)) return name.replace(re,short);
    return name;
  }
  // КНП is a useful signal, but the payment description and direction take priority.
  // All results remain suggestions, never verified 1C catalogue entries.
  function suggestArticleDetailed(purpose,direction,knp="",counterparty="") {
    const p=norm(purpose),cp=norm(counterparty);
    const raw=String(knp??"").trim();
    const code=/^\d{1,3}$/.test(raw)?raw.padStart(3,"0"):raw;
    if(!direction||!p)return {article:"",reason:"Недостаточно данных",confidence:"none"};
    const suggestion=(article,reason,confidence="high")=>({article,reason,confidence});
    const isOutgoing=direction==="Исходящее";
    const isIncoming=direction==="Входящее";
    if(!isOutgoing&&!isIncoming)return {article:"",reason:"Неизвестное направление",confidence:"none"};

    // Bank charges often mention НДС, ОПВ, штрафы or пени of the *underlying*
    // transaction, so recognize the charge before any tax rules.
    const bankFee=/(комисси.{0,25}(банк|операц|перевод)|банк.{0,25}комисси|обслуживани.{0,12}(счет|счёт)|согласно тарифам банка|эквайрингов.{0,12}комисси)/.test(p);
    if(isOutgoing&&(bankFee||(code==="841"&&/(комисси|тариф|банковск)/.test(p))))
      return suggestion("Банковские комиссии","Комиссия банка"+(code==="841"?" · КНП 841":""));

    // Kaspi extracts fees under service descriptions without the word "комиссия".
    // Use both the payment description and service provider for confidence.
    const kaspiBank=/(каспи|kaspi).{0,15}банк|(каспи|kaspi)\s*bank/.test(cp);
    const kaspiProcessor=/(каспи|kaspi)\s*pay/.test(cp);
    if(isOutgoing&&kaspiBank&&/услуг.{0,30}операц.{0,20}по картам|операц.{0,22}по картам.{0,25}kaspi gold/.test(p))
      return suggestion("Банковские комиссии","Услуги банка за операции по картам Kaspi Gold; сверьте тариф и документы","review");
    if(isOutgoing&&kaspiProcessor&&/услуг.{0,15}процессинг|процессинг.{0,20}платеж/.test(p))
      return suggestion("Услуги эквайринга и процессинга","Услуги Kaspi Pay по обработке платежей; сверьте акт и расчёты","review");
    if(isIncoming&&/(продажи\s+с\s+(kaspi\.?(?:kz)?|каспи)|продажи\s+через\s+(kaspi|каспи))/.test(p))
      return suggestion("Оплата от покупателя","Зачисление продаж через Kaspi; сверьте с эквайрингом и счётом 1274, а не считайте новым доходом","review");

    if(isOutgoing&&(/алимент/.test(p)||(code==="118"&&/дет|содержани|алим/.test(p))))
      return suggestion("Алименты","Алименты"+(code==="118"?" · КНП 118":""),"review");
    if(isOutgoing&&/(исполнительн.{0,30}(производств|лист)|судебн.{0,20}исполн|взыскани.{0,20}по исполнительн)/.test(p))
      return suggestion("Исполнительные документы","Перечисление по исполнительному документу; сверьте статью с 1С","review");

    if(isOutgoing&&/возврат продаж.{0,35}(kaspi|каспи)/.test(p))
      return suggestion("Возврат денежных средств","Возврат продаж через Kaspi: сверьте с возвратом покупателю и эквайринговыми расчётами","review");
    if(isIncoming&&/возврат оплат.{0,50}услуг.{0,35}операц.{0,30}по картам/.test(p))
      return suggestion("Возврат денежных средств","Возврат списания за карточные услуги; проверьте корректировку банковской комиссии","review");
    if(isOutgoing&&/(возврат.{0,24}(денежн|оплат|платеж|покупател)|возврат покупателю)/.test(p))
      return suggestion("Возврат денежных средств","Возврат платежа");
    if(isIncoming&&/(возврат.{0,25}(от поставщик|переплат|денежн|платеж)|возврат поставщиком)/.test(p))
      return suggestion("Возврат денежных средств","Возврат поступления");
    if(/(между своими счетами|между собственными счетами|со своего счета|на свой счет|внутренн.{0,10}перевод|перемещени.{0,22}(счет|счёт))/.test(p))
      return suggestion("Перевод между счетами","Перемещение собственных денежных средств","review");

    if(isOutgoing){
      // Government fees are not taxes or social contributions. Require a
      // specific levy description plus a budget/authority/KNP signal to avoid
      // mistaking commercial advertising services for a state payment.
      const stateReceiver=/(?:^|[^а-яa-z])(угд|кгд|дгд|казначейств)(?=$|[^а-яa-z])|управлени.{0,16}государственн.{0,15}доход/.test(cp);
      const budgetContext=code==="911"||stateReceiver||/в бюджет|гос.?бюджет/.test(p);
      const outdoorAdFee=/(?:^|[\s,;])плат[аы]\s+за\s+разм[а-я.]*\s+(?:наружн[а-я]*|нар(?=$|[^а-яa-z0-9])).{0,45}рекл[а-я]*/.test(p);
      const officialFee=/(государственн.{0,16}пошлин|госпошлин|регистрационн.{0,16}сбор|сбор за выдачу.{0,25}(лиценз|разрешен)|плат[аы]\s+за\s+пользовани.{0,18}земельн)/.test(p);
      if(budgetContext&&(outdoorAdFee||officialFee))
        return suggestion("Другие обязательные платежи в бюджет",
          (outdoorAdFee?"Плата за размещение наружной (визуальной) рекламы":"Госпошлина, сбор или иная плата в бюджет")+
          "; проверьте основание начисления и КБК"+(code?" · КНП "+code:""),"review");

      const social=/(обязательн.{0,12}пенсионн.{0,12}взнос|пенсионн.{0,12}взнос работодател|обязательн.{0,15}социальн.{0,15}отчислен|взнос.{0,30}социальн.{0,20}медицинск|отчислен.{0,30}социальн.{0,20}медицинск|обязательн.{0,12}социальн.{0,12}медицинск|социальн.{0,12}отчислен)/.test(p);
      const tax=/(социальн.{0,6}налог|индивидуальн.{0,12}подоходн.{0,6}налог|корпоративн.{0,12}подоходн.{0,6}налог|налог на добавленн.{0,12}стоим|уплат.{0,15}налог|уплат.{0,10}ндс|перечислен.{0,10}ндс|ндс.{0,20}в бюджет|налог.{0,12}в бюджет|обязательств.{0,12}в бюджет)/.test(p);
      const taxAbbr=/(?:^|[^a-zа-я0-9])(опв|опвр|осмс|восмс|ипн|кпн)(?=$|[^a-zа-я0-9])/.test(p);
      if(social||tax||taxAbbr||(code==="911"&&/налог|бюджет/.test(p))||
        (["010","012","089","121","122"].includes(code)&&/взнос|отчислен|страхован/.test(p)))
        return suggestion("Налоги и отчисления","Налоги, взносы или отчисления"+(code?" · КНП "+code:""));
      if(/(зарплат|заработн.{0,9}плат|з\/п|оплата труда|аванс сотруд|преми.{0,12}сотруд)/.test(p))
        return suggestion("Заработная плата","Выплата заработной платы");
      if(/(аренд|арендная плата)/.test(p))
        return suggestion("Аренда","Арендный платёж");
      if(/(погашен.{0,15}(кредит|займ)|возврат.{0,15}(кредит|займ))/.test(p))
        return suggestion("Погашение займа","Погашение обязательства по займу");
      // ДТ-Л / ДТЛ = летнее дизельное топливо. Treat it as fuel
      // purchase even if the payment lacks "АЗС" or "бензин".
      const dieselGrade=p.match(/(?:^|[^а-яa-z0-9])дт[\s\-–—]*([лзеа])(?=$|[^а-яa-z0-9])/);
      const fuelPurchase=!!dieselGrade||/(дизельн.{0,18}топлив|дизтоплив|горюче.?смазочн|(?:^|[^а-яa-z0-9])гсм(?:$|[^а-яa-z0-9])|(?:^|[^а-яa-z0-9])азс(?:$|[^а-яa-z0-9])|бензин|(?:^|[^а-яa-z0-9])аи[\s\-]*(92|95|98)(?=$|[^а-яa-z0-9]))/.test(p);
      if(fuelPurchase)
        return suggestion("Приобретение ГСМ",
          dieselGrade?"Приобретение ДТ-"+dieselGrade[1].toUpperCase()+" ("+({л:"летнее",з:"зимнее",е:"межсезонное",а:"арктическое"}[dieselGrade[1]]||"дизельное")+" дизельное топливо); проверьте документы на топливо":"Приобретение топлива (ГСМ); проверьте чек или накладную","review");
      if(["710","819","859","854"].includes(code))
        return suggestion("Оплата поставщику","Оплата товаров или услуг · КНП "+code,"medium");
      if(/(оплат|приобретен|счет на оплату|счёта на оплату|поставщик|за товар|за услуг|за работ|по договору)/.test(p))
        return suggestion("Оплата поставщику","Оплата товаров или услуг по назначению","medium");
    } else {
      if(/(получен.{0,15}(займ|кредит)|выдач.{0,10}займ|поступлен.{0,15}заемн)/.test(p))
        return suggestion("Получение займа","Получение займа");
      if(["710","819","859"].includes(code))
        return suggestion("Оплата от покупателя","Поступление за товары или услуги · КНП "+code,"medium");
      if(/(оплат|покупател|выручк|реализац|оказанн.{0,10}услуг|за товар|за услуг|за работ|по счету|по сч)/.test(p))
        return suggestion("Оплата от покупателя","Оплата покупателя по назначению","medium");
    }
    return {article:"",reason:code?"Неоднозначное назначение · КНП "+code:"Неоднозначное назначение",confidence:"none"};
  }
  function suggestArticle(purpose,direction,knp="",counterparty=""){
    return suggestArticleDetailed(purpose,direction,knp,counterparty).article;
  }


  // Draft postings only; ambiguous account correspondences are left blank.
  function suggestPosting(x) {
    const p=norm(x.purpose), article=x.article||"", direction=x.direction;
    const result={debit:"",credit:"",debitReason:"",creditReason:""};
    if(direction==="Исходящее") {
      result.credit="1030";
      result.creditReason="Списание денежных средств с расчётного счёта";
      if(article==="Банковские комиссии") {
        result.debit="7210";
        result.debitReason="Предполагаемые административные расходы на банковскую комиссию; сверьте счёт затрат";
      } else if(article==="Алименты" && /алимент/.test(p)) {
        result.debit="3390";
        result.debitReason="Перечисление ранее удержанных алиментов; проверьте счёт задолженности";
      } else if(article==="Заработная плата" && /(зарплат|заработн.{0,9}плат|з\/п|выплат.{0,20}сотруд)/.test(p)) {
        result.debit="3350";
        result.debitReason="Выплата ранее начисленной заработной платы";
      } else if(article==="Другие обязательные платежи в бюджет") {
        // Suggested settlement of an already accrued obligatory levy, not an
        // expense recognition entry. Manual 1C verification is mandatory.
        result.debit="3230";
        result.debitReason="Предполагаемое погашение начисленного другого обязательного платежа; проверьте начисление, КБК и субсчёт 3230 в 1С";
      } else if(article==="Налоги и отчисления") {
        // KNP and explicit payment purpose determine the *liability* account,
        // not the expense account. A generic "tax payment" is left unresolved.
        // Particular subaccounts (3211/3212/3213/3250) must be checked in 1C.
        const knp=/^\d{1,3}$/.test(String(x.knp||"").trim())?String(x.knp).trim().padStart(3,"0"):"";
        const candidates=[
          ["3250","Обязательные пенсионные взносы работодателя",/(опвр|пенсионн.{0,20}взнос.{0,20}работодател)/,["089"]],
          ["3220","Обязательные пенсионные взносы работников",/(опв(?!р)|обязательн.{0,12}пенсионн.{0,12}взнос(?![^.]{0,20}работодател))/,["010"]],
          ["3211","Социальные отчисления",/(социальн.{0,12}отчислен|соц\.?\s*отчислен)/,["012"]],
          ["3212","Взносы на ОСМС",/(восмс|взнос.{0,30}(медицинск|осмс))/,["122"]],
          ["3213","Отчисления на ОСМС",/(оосмс|отчислен.{0,30}(медицинск|осмс))/,["121"]],
          ["3120","Индивидуальный подоходный налог",/(индивидуальн.{0,15}подоходн.{0,12}налог|(?:^|[^а-я])ипн(?:$|[^а-я]))/,[]],
          ["3110","Корпоративный подоходный налог",/(корпоративн.{0,15}подоходн.{0,12}налог|(?:^|[^а-я])кпн(?:$|[^а-я]))/,[]],
          ["3130","НДС к уплате в бюджет",/(налог.{0,20}добавленн.{0,16}стоим|(?:уплат|перечислен).{0,18}ндс|ндс.{0,22}в бюджет)/,[]],
          ["3150","Социальный налог",/социальн.{0,8}налог/,[]],
          ["3160","Земельный налог",/земельн.{0,8}налог/,[]],
          ["3170","Налог на транспорт",/налог.{0,12}транспорт/,[]],
          ["3180","Налог на имущество",/налог.{0,12}имуществ/,[]]
        ];
        const matches=candidates.filter(([, ,re,knps])=>re.test(p)||(knp&&knps.includes(knp)));
        if(matches.length===1) {
          const [account,label]=matches[0];
          result.debit=account;
          result.debitReason="Предполагаемое погашение обязательства: "+label+"; проверьте счёт и аналитику в своей базе 1С"+(knp?" (КНП "+knp+")":"");
        }
      } else if(article==="Оплата поставщику" && /(аванс|предоплат|предварительн.{0,10}оплат)/.test(p)) {
        result.debit="1610";
        result.debitReason="Аванс поставщику; проверьте договор и аналитику";
      } else if(article==="Оплата поставщику" && /(погашен.{0,24}задолжен|оплат.{0,25}ранее (поставлен|получен|оказан)|погашени.{0,15}кредитор)/.test(p)) {
        result.debit="3310";
        result.debitReason="Погашение задолженности поставщику; проверьте обязательство";
      }
    } else if(direction==="Входящее") {
      result.debit="1030";
      result.debitReason="Поступление денежных средств на расчётный счёт";
      if(article==="Оплата от покупателя" && /(аванс|предоплат|предварительн.{0,10}оплат)/.test(p)) {
        result.credit="3510";
        result.creditReason="Полученный аванс покупателя; проверьте договор";
      } else if(article==="Оплата от покупателя" && /(погашен.{0,24}задолжен|оплат.{0,25}ранее (отгружен|поставлен|оказан)|погашени.{0,15}дебитор)/.test(p)) {
        result.credit="1210";
        result.creditReason="Погашение задолженности покупателя; проверьте дебиторскую задолженность";
      }
    }
    return result;
  }
  // Recalculate suggestions only for fields that were empty or auto-filled.
  // Explicitly entered numbers, including edits from old drafts, always win.
  function refreshSuggestedPosting(x) {
    const proposal=suggestPosting(x);
    let changed=false;
    for(const side of ["debit","credit"]) {
      const source=side+"Source", reason=side+"Reason";
      if(["manual","statement"].includes(x[source]))continue;
      if(x[side] && x[source]!=="auto")continue;
      const newValue=proposal[side]||"";
      if(x[side]!==newValue)changed=true;
      x[side]=newValue;
      x[source]=newValue?"auto":"";
      x[reason]=newValue?proposal[reason]:"";
    }
    x.status=validateOperation(x);
    return changed;
  }

  const BANK_FEE_DOCUMENT="Платёжный ордер (списание денежных средств)";
  function suggestDocumentType(direction,article) {
    if(direction==="Входящее")return "Платёжное поручение входящее";
    if(direction==="Исходящее")return article==="Банковские комиссии"
      ?BANK_FEE_DOCUMENT:"Платёжное поручение исходящее";
    return "";
  }
  function suggestDocumentOperation(article,docType) {
    if(article==="Банковские комиссии" && docType===BANK_FEE_DOCUMENT)
      return "Прочее списание безналичных денежных средств";
    return "";
  }
  // Respect explicitly saved 1C document choices when DDS rules are updated.
  // Legacy drafts lack docTypeSource; only migrate the original default documents.
  function refreshSuggestedDocument(x) {
    if(x.docTypeSource==="manual")return false;
    const ordinary=suggestDocumentType(x.direction,"");
    if(!x.docTypeSource && x.docType && x.docType!==ordinary)return false;
    const proposal=suggestDocumentType(x.direction,x.article);
    if(!proposal)return false;
    const changed=x.docType!==proposal;
    x.docType=proposal;
    x.docTypeSource="auto";
    return changed;
  }

  // Read owner identity only from the statement header, not from transaction
  // counterparties. Unknown fields remain empty (never guessed).
  function extractStatementCompany(matrix, bankHint="") {
    const info={name:"",bin:"",bank:"",account:"",period:"",currency:""};
    if(!Array.isArray(matrix))return info;
    const labels={
      name:["наименование","наименование клиента","наименование организации","организация","владелец счета","клиент","получатель выписки"],
      bin:["иин/бин","бин/иин","бин","иин","иин/бИН владельца","иин/бин клиента","бин/иин клиента"],
      account:["текущий счет","текущий счёт","расчетный счет","расчётный счёт","номер счета","номер счёта","иик","иик клиента","iban","счет клиента","счёт клиента"],
      bank:["банк","наименование банка","обслуживающий банк","банк клиента"],
      period:["период","период выписки","за период"],
      currency:["валюта счета","валюта счёта","валюта"]
    };
    const aliasToField=new Map();
    for(const [field,names] of Object.entries(labels)){
      for(const name of names)aliasToField.set(norm(name),field);
    }
    const max=Math.min(90,matrix.length);
    for(let i=0;i<max;i++){
      const cells=Array.isArray(matrix[i])?matrix[i]:[matrix[i]];
      const normalized=cells.map(cell=>norm(cell));
      if(normalized.includes("дата операции")&&
        normalized.some(text=>["дебет","кредит","сумма","сумма операции"].includes(text)))break;
      for(let col=0;col<cells.length;col++){
        const cell=String(cells[col]??"").trim();
        if(!cell)continue;
        const sameCell=cell.match(/^(.{2,55}?)\s*[:：]\s*(.+)$/u);
        const label=norm((sameCell?sameCell[1]:cell).replace(/[:：]\s*$/,""));
        const field=aliasToField.get(label);
        if(!field||info[field])continue;
        const next=sameCell?sameCell[2]:
          cells.slice(col+1).find(value=>String(value??"").trim()&&!aliasToField.has(norm(value).replace(/[:：]\s*$/,"")));
        const value=String(next??"").trim().slice(0,240);
        if(!value)continue;
        if(field==="bin"){if(/^\d{12}$/.test(value))info.bin=value;continue;}
        if(field==="account"){if(/^KZ[A-Z0-9]{18}$/i.test(value))info.account=value.toUpperCase();continue;}
        if(field==="currency"){if(/^(KZT|USD|EUR|RUB|GBP|CNY)$/i.test(value))info.currency=value.toUpperCase();continue;}
        if(field==="period"){if(/^\d{2}\.\d{2}\.\d{4}\s*[-–—]\s*\d{2}\.\d{2}\.\d{4}$/.test(value))info.period=value;continue;}
        if(field==="bank"){if(value.length>=3)info.bank=value;continue;}
        if(field==="name"&&value.length>=3&&!/^\d+$/.test(value))info.name=value;
      }
    }
    // Kaspi bank statement schema has a distinct header and footer.
    // This identifies the export format, not a bank from its counterparties.
    if(!info.bank && info.account && matrix.some(row=>
      (Array.isArray(row)?row:[row]).some(cell=>norm(cell)==="итого обороты в валюте счета")) &&
      matrix.some(row=>(Array.isArray(row)?row:[row]).some(cell=>norm(cell)==="наименование бенефициара / отправителя денег"))){
      info.bank="Kaspi Bank";
    }
    if(!info.bank&&bankHint)info.bank=String(bankHint).slice(0,120);
    return info;
  }
  function mergeStatementCompanies(items) {
    const fields=["name","bin","bank","account","period","currency"];
    const result=Object.fromEntries(fields.map(field=>[field,""]));
    for(const field of fields){
      const values=[...new Set(items.map(item=>String(item?.[field]||"").trim()).filter(Boolean))];
      // An aggregated file may contain different accounts or organizations.
      // Never display a single owner's identity if the source is ambiguous.
      result[field]=values.length===1?values[0]:"";
    }
    return result;
  }
  const aliases = {
    date:["дата операции","дата документа","дата платежа","дата валютирования","дата проводки","дата","operation date","transaction date"],
    payer:["наименование плательщика","плательщик","отправитель","от кого","payer","sender"],
    receiver:["наименование получателя","получатель","кому","receiver","beneficiary"],
    name:["наименование бенефициара / отправителя денег","наименование контрагента","контрагент","название контрагента","counterparty","контрагент атауы","корреспондент"],
    comment:["комментарий","комментарии","комментарий банка","комментарий к операции","примечание","примечания","memo","transaction memo","payment comment","comment","remarks","note"],
    purpose:["назначение платежа","назначение","детали платежа","описание платежа","описание","purpose","details","description","төлем мақсаты"],
    amount:["сумма операции","сумма платежа","сумма в валюте счета","сумма","amount","сумма в тенге","сомасы"],
    debit:["сумма по дебету","дебетовая сумма","сумма дебет","расход","списание","дебет","debit","withdrawal","money out","шығыс"],
    credit:["сумма по кредиту","кредитовая сумма","сумма кредит","приход","поступление","кредит","credit","deposit","money in","кіріс"],
    direction:["индикатор дебета/кредита","индикатор дебета кредита","дебет/кредит","тип операции","направление","direction","дебет кредит"],
    bankDoc:["тип документа","вид документа","документ","document type"],
    number:["номер документа","№ документа","номер платежа","референс","reference","document number"],
    accountDebit:["счет дебета","счёт дебета","счет дебет","дебет счет","счет списания"],
    accountCredit:["счет кредита","счёт кредита","счет кредит","кредит счет","счет зачисления"],
    bin:["бин/иин контрагента","бин контрагента","иин контрагента","бин","иин","бин/иин","иин/бин"],
    knp:["кнп","код назначения платежа"],
    bankRef:["референс операции абис","референс операции","идентификатор транзакции","transaction id"]
  };
  function colIndex(headers,key) {
    if(key==="date") {
      // "Дата выписки" is the export generation date, not the payment date.
      for(const wanted of ["дата документа","дата операции","дата платежа","дата валютирования","дата проводки","operation date","transaction date","booking date","date","күні","операция күні","дата"]){
        const i=headers.indexOf(wanted);
        if(i>=0)return i;
      }
      return -1;
    }
    const exact=headers.findIndex(h=>aliases[key].includes(h));
    if(exact>=0)return exact;
    // Never accidentally treat "Сумма НДС", debit or credit as total amount.
    if(key==="amount")return -1;
    if(key==="debit"||key==="credit"){
      return headers.findIndex(h=>aliases[key].some(alias=>h.includes(alias)) &&
        !/счет|счёт|индикатор|дебет.*кредит|credit.*debit|debit.*credit|остаток|сальдо/.test(h));
    }
    return headers.findIndex(h=>aliases[key].some(a=>h.includes(a)));
  }
  function parseRows(matrix, sheetName="", mapping=null) {
    if (!Array.isArray(matrix) || !matrix.length) return [];
    let header=mapping?.header ?? -1;
    let cols=mapping?.columns;
    if(!cols){
      for(let i=0;i<matrix.length;i++){
        const headers=(matrix[i]||[]).map(norm);
        if(colIndex(headers,"date")<0)continue;
        const indices=Object.fromEntries(Object.keys(aliases).map(key=>[key,colIndex(headers,key)]));
        if([indices.amount,indices.debit,indices.credit].some(index=>index>=0)){
          header=i;
          cols=indices;
          break;
        }
      }
    }
    if(!cols)return [];
    const result=[];
    for(let rowIdx=header+1;rowIdx<matrix.length;rowIdx++){
      const row=matrix[rowIdx]||[];
      if(!row.some(v=>String(v??"").trim()))continue;
      if(rowIdx===header+1 && row.length>=3 && row.every((v,i)=>String(v).trim()===String(i+1)))continue;
      const get=key=>cols[key]>=0?row[cols[key]]:"";
      if(!dateText(get("date")) && row.some(cell=>/^(итого|всего|обороты|сальдо|остаток|total)(?:$|[ :])/i.test(String(cell).trim())))continue;
      const debit=money(get("debit")),credit=money(get("credit")),originalAmount=money(get("amount"));
      const hasDebit=Number.isFinite(debit)&&debit!==0, hasCredit=Number.isFinite(credit)&&credit!==0;
      const rawDirection=norm(get("direction"));
      let direction="";
      if(hasDebit&&hasCredit) direction="";
      else if(hasCredit) direction="Входящее";
      else if(hasDebit) direction="Исходящее";
      else if(/^(вход|приход|поступ|credit|crdt|кредит|кт$|к$|c$)/.test(rawDirection)) direction="Входящее";
      else if(/^(исход|расход|спис|debit|dbit|дебет|дт$|д$|d$)/.test(rawDirection)) direction="Исходящее";
      else if(Number.isFinite(originalAmount)&&originalAmount<0) direction="Исходящее";
      const amount=Number.isFinite(originalAmount)&&originalAmount!==0?originalAmount:(hasDebit?debit:hasCredit?credit:NaN);
      if(!Number.isFinite(amount)||!amount) continue;
      const payer=String(get("payer")||"").trim(), receiver=String(get("receiver")||"").trim();
      const partyText=fixTengeText(get("name")||(direction==="Входящее"?payer:receiver)||payer||receiver||"").trim();
      const embeddedBin=partyText.match(/\s+(?:ИИН\s*\/\s*БИН|БИН\s*\/\s*ИИН)[:\s]+(\d{12})\s*$/i);
      const companyName=embeddedBin?partyText.slice(0,embeddedBin.index).trim():partyText;
      const purpose=fixTengeText(get("purpose")||"").trim();
      const comment=fixTengeText(get("comment")||"").trim().slice(0,3000);
      const rawKnp=String(get("knp")??"").trim();
      const knp=/^\d{1,3}$/.test(rawKnp)?rawKnp.padStart(3,"0"):rawKnp;
      const articleSuggestion=suggestArticleDetailed(purpose,direction,knp,companyName);
      const article=articleSuggestion.article;
      const bankDebit=String(get("accountDebit")||"").trim(),bankCredit=String(get("accountCredit")||"").trim();
      const docType=suggestDocumentType(direction,article);
      const entry={
        id:0, date:dateText(get("date")), name:shortLegalName(companyName), originalName:companyName, purpose, comment,
        amount:roundMoney(Math.abs(amount)), direction, docType, docTypeSource:docType?"auto":"", article, articleSource:article?"auto":"",
        articleReason:articleSuggestion.reason,articleConfidence:articleSuggestion.confidence,knp,bankRef:String(get("bankRef")??"").trim(),
        debit:/^\d{4}$/.test(bankDebit)?bankDebit:"", debitSource:/^\d{4}$/.test(bankDebit)?"statement":"",
        credit:/^\d{4}$/.test(bankCredit)?bankCredit:"", creditSource:/^\d{4}$/.test(bankCredit)?"statement":"",
        debitReason:"",creditReason:"",
        bin:String(get("bin")||embeddedBin?.[1]||"").trim(), sourceDoc:String(get("bankDoc")||"").trim(),
        docNumber:String(get("number")||"").trim(), sourceSheet:sheetName,
        possibleDuplicate:false, duplicateConfirmed:false, status:"review"
      };
      refreshSuggestedPosting(entry);
      result.push(entry);
    }
    return result;
  }
  function duplicateKey(x) {
    if(!x.date||!x.direction||!x.amount) return "";
    const ref=norm(x.docNumber);
    const identity=norm(x.bin||x.originalName||x.name);
    const purpose=norm(x.purpose);
    if(!identity&&!ref) return "";
    return [x.date,x.direction,roundMoney(x.amount),identity,ref||purpose].join("|");
  }
  function markDuplicates(ops) {
    const seen=new Map();
    for (const x of ops) x.possibleDuplicate=false;
    for (const x of ops) {
      const key=duplicateKey(x);
      if(!key) continue;
      if(seen.has(key)) {
        x.possibleDuplicate=true;
        seen.get(key).possibleDuplicate=true;
      } else seen.set(key,x);
    }
    for (const x of ops) x.status=validateOperation(x);
    return ops;
  }

  // Inline table editing: a four-digit draft account or an intentional blank.
  // This sets only the selected side and never confirms accounting correctness.
  function setManualPostingAccount(x,side,value){
    if(side!=="debit"&&side!=="credit")return false;
    const account=String(value??"").trim();
    if(account!==""&&!/^\d{4}$/.test(account))return false;
    x[side]=account;
    x[side+"Source"]="manual";
    x[side+"Reason"]=account?"Счёт выбран бухгалтером в таблице":"Счёт очищен бухгалтером";
    x.status=validateOperation(x);
    return true;
  }

  // Apply a reviewed posting to repeated transactions within the loaded
  // statement. Match on direction, counterparty, KNP and payment purpose,
  // ignoring only the calendar date in the purpose, never amount or card ID.
  function operationRuleKey(x){
    if(!x||!x.direction)return "";
    const counterparty=norm(x.originalName||x.name);
    const rawPurpose=norm(x.purpose);
    if(!counterparty||!rawPurpose)return "";
    const template=rawPurpose
      .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g,"{дата}")
      .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,"{дата}")
      .replace(/\s+/g," ").trim();
    return [x.direction,counterparty,norm(x.knp),template].join("|");
  }
  function canCopyPostingField(source,target,field){
    if(!["article","docType","debit","credit"].includes(field))return false;
    const value=String(source[field]||"").trim();
    if(!value)return false;
    if((field==="debit"||field==="credit")&&!/^\d{4}$/.test(value))return false;
    // Do not replace values deliberately entered by the accountant or read from the bank.
    if(["manual","statement"].includes(target[field+"Source"]))return false;
    return target[field]!==value||target[field+"Source"]!=="manual";
  }
  // Show an apply button only for matching operations that can actually receive
  // the selected fields. Otherwise the user sees "apply to N" but nothing changes.
  function countSimilarOperations(operations,source,fields=["article","docType","debit","credit"]){
    const key=operationRuleKey(source);
    return key?operations.filter(target=>target!==source&&target.id!==source.id&&
      operationRuleKey(target)===key&&fields.some(field=>canCopyPostingField(source,target,field))).length:0;
  }
  function applyPostingToSimilar(operations,source,ruleKey=operationRuleKey(source),fields=["article","docType","debit","credit"]){
    if(!ruleKey)return {matched:0,updated:0};
    let matched=0,updated=0;
    for(const target of operations){
      if(target===source||target.id===source.id||operationRuleKey(target)!==ruleKey)continue;
      matched++;
      let changed=false;
      for(const field of fields){
        if(!canCopyPostingField(source,target,field))continue;
        const value=String(source[field]||"").trim();
        const sourceField=field+"Source";
        target[field]=value;
        target[sourceField]="manual";
        if(field==="article")target.articleReason="Применено бухгалтером к аналогичным операциям";
        if(field==="debit"||field==="credit")target[field+"Reason"]="Счёт перенесён из проверенной аналогичной операции; подтвердите в 1С";
        changed=true;
      }
      if(changed){
        refreshSuggestedDocument(target);
        refreshSuggestedPosting(target);
        target.status=validateOperation(target);
        updated++;
      }
    }
    return {matched,updated};
  }
  // A filled-out form is not a reconciled 1C posting. These are prompts for
  // accountant verification, never a claim of ledger correctness.
  function reconciliationNotes(x) {
    const notes=[];
    if(x.debitSource==="auto" || x.creditSource==="auto") notes.push("Автоматический Дт/Кт: сверить корреспонденцию счетов с 1С");
    if(x.articleSource==="auto") notes.push("Предложенная статья ДДС: сопоставить со справочником 1С");
    if(x.docTypeSource==="auto") notes.push("Предложенный тип документа: проверить в 1С");
    if(x.article==="Оплата поставщику" || x.article==="Оплата от покупателя")
      notes.push("Проверить по договору: аванс или погашение задолженности");
    if(x.article==="Услуги эквайринга и процессинга")
      notes.push("Услуги процессинга: проверить договор/акт, назначение расходного счёта и расчёты с Kaspi Pay; не подставлять 7210 или 3310 без проверки");
    if(x.direction==="Входящее"&&/(продажи\s+с\s+(kaspi|каспи)|продажи\s+через\s+(kaspi|каспи))/.test(norm(x.purpose)))
      notes.push("Поступление через Kaspi: сверить с оплатами покупателей, выручкой и транзитным счётом эквайринга 1274; не задваивать доход");
    if(x.article==="Перевод между счетами")
      notes.push("Сверить оба собственных банковских счёта и не относить перевод на расходы");
    if(x.article==="Алименты" || x.article==="Исполнительные документы")
      notes.push("Сверить задолженность и основание удержания");
    if(x.article==="Налоги и отчисления")
      notes.push("Сверить вид налога, субсчёт обязательства и КНП");
    if(x.article==="Другие обязательные платежи в бюджет")
      notes.push("Проверить КБК, получателя и начисление обязательства по счёту 3230; это не налог и не подтверждённая проводка 1С");
    if(x.article==="Приобретение ГСМ")
      notes.push("Покупка ГСМ: проверить чек/накладную, аванс или задолженность и способ оплаты; банковский платёж не подтверждает оприходование топлива");
    return notes;
  }
  function validateOperation(x) {
    const dir=x.direction, type=x.docType||"";
    const compatible=dir==="Входящее" ? ["Платёжное поручение входящее","ПКО","Поступление на расчётный счёт"].includes(type) :
      dir==="Исходящее" ? ["Платёжное поручение исходящее","РКО","Списание с расчётного счёта",BANK_FEE_DOCUMENT].includes(type) : false;
    const cashAccountValid=(type==="ПКО")?String(x.debit)==="1010":
      (type==="РКО")?String(x.credit)==="1010":true;
    const ready=!!(x.date && x.name?.trim() && x.purpose?.trim() && Number(x.amount)>0 &&
      dir && compatible && cashAccountValid && x.article?.trim() && /^\d{4}$/.test(String(x.debit||"")) &&
      /^\d{4}$/.test(String(x.credit||"")) && (!x.possibleDuplicate||x.duplicateConfirmed));
    if(ready) return "ready";
    return compatible && x.date && !x.possibleDuplicate ? "detected":"review";
  }
  // Period filtering applies to loaded operations only. It never changes
  // the source statement, and missing dates do not match selected periods.
  function filterPeriod(rows,{date="",month="",from="",to=""}={}){
    const day=dateText(date);
    const validMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:"";
    const start=dateText(from),finish=dateText(to);
    if(!day&&!validMonth&&!start&&!finish)return rows;
    const iso=value=>value.slice(6,10)+"-"+value.slice(3,5)+"-"+value.slice(0,2);
    const first=start?iso(start):"",last=finish?iso(finish):"";
    return rows.filter(operation=>{
      const value=dateText(operation.date);
      if(!value)return false;
      const candidate=iso(value);
      return (!day||value===day)&&(!validMonth||candidate.slice(0,7)===validMonth)&&
        (!first||candidate>=first)&&(!last||candidate<=last);
    });
  }
  function totals(rows) {
    const incoming=roundMoney(rows.filter(x=>x.direction==="Входящее").reduce((s,x)=>s+Number(x.amount||0),0));
    const outgoing=roundMoney(rows.filter(x=>x.direction==="Исходящее").reduce((s,x)=>s+Number(x.amount||0),0));
    return {incoming,outgoing,net:roundMoney(incoming-outgoing),count:rows.length,unknown:rows.filter(x=>!x.direction).length};
  }
  return {extractStatementCompany,mergeStatementCompanies,norm,fixTengeText,escapeHtml,money,dateText,shortLegalName,suggestArticle,suggestArticleDetailed,suggestPosting,refreshSuggestedPosting,suggestDocumentType,suggestDocumentOperation,refreshSuggestedDocument,parseRows,markDuplicates,validateOperation,reconciliationNotes,setManualPostingAccount,operationRuleKey,countSimilarOperations,applyPostingToSimilar,filterPeriod,totals,BANK_FEE_DOCUMENT};
});

