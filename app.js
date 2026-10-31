(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const palette = [
    ['#e7f0df','#54754d'],['#f6e5dc','#a56b4c'],['#e5e9f3','#62749b'],
    ['#f3e8c9','#947a37'],['#e9e0f1','#826596'],['#dcecef','#4f8790'],
    ['#f3e0e7','#a15e7a']
  ];
  let me = null, lastId = 0, polling = false, pending = false, timer = null, toastTimer;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showToast(message) { const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600); }
  async function api(path, options={}) {
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||'ارتباط با اتاق برقرار نشد.');error.status=response.status;throw error;}
    return data;
  }
  function showScreen(name) { $('loginScreen').hidden=name!=='login';$('chatScreen').hidden=name!=='chat'; }
  function initials(name) { return [...(name||'؟')][0]||'؟'; }
  function colorIndex(name) { let n=0;for(const c of name)n=(n*31+c.codePointAt(0))|0;return Math.abs(n)%palette.length; }
  function timeLabel(time) { return new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit'}).format(new Date(time)); }
  function relativeLabel(time) { const minutes=Math.max(0,Math.floor((Date.now()-time)/60000));if(minutes<1)return 'همین الان';if(minutes<60)return `${minutes.toLocaleString('fa-IR')} دقیقه پیش`;return timeLabel(time); }
  function renderPeople(names) {
    $('peopleCount').textContent=`${names.length.toLocaleString('fa-IR')} نفر`;
    const list=$('peopleList');list.replaceChildren();
    if(!names.length){const empty=document.createElement('div');empty.className='people-loading';empty.textContent='فعلاً کسی در اتاق نیست.';list.append(empty);return;}
    for(const name of names){const row=document.createElement('div');row.className='person';const avatar=document.createElement('span');avatar.className=`person-avatar tone-${colorIndex(name)}`;avatar.textContent=initials(name);const copy=document.createElement('div');const label=document.createElement('div');label.className='person-name';label.textContent=name;const status=document.createElement('div');status.className='person-status';status.textContent=name===me?'خودت':'حاضر در اتاق';copy.append(label,status);const dot=document.createElement('i');dot.className='person-dot';row.append(avatar,copy,dot);list.append(row);}
  }
  function appendMessage(message) {
    if($('chatEmpty'))$('chatEmpty').remove();
    const mine=message.username===me,row=document.createElement('article');row.className=`message-row ${mine?'mine':'theirs'}`;row.dataset.id=message.id;
    const avatar=document.createElement('span');avatar.className=`message-avatar tone-${colorIndex(message.username)}`;avatar.textContent=initials(message.username);
    const content=document.createElement('div');content.className='message-content';
    if(!mine){const name=document.createElement('div');name.className='message-name';name.textContent=message.username;content.append(name);}
    const bubble=document.createElement('div');bubble.className='message-bubble';bubble.textContent=message.body;
    const meta=document.createElement('div');meta.className='message-meta';meta.textContent=relativeLabel(message.created_at);content.append(bubble,meta);row.append(avatar,content);$('messages').append(row);lastId=Math.max(lastId,Number(message.id)||0);
  }
  function setConnection(text,online=false) { $('syncLabel').textContent=text;$('syncLabel').classList.toggle('connected',online); }
  async function syncMessages(initial=false) {
    if(polling||!me)return;polling=true;
    try{
      const path=initial?'/api/messages':`/api/messages?after=${lastId}`;
      const result=await api(path);for(const message of result.messages)appendMessage(message);renderPeople(result.activeUsers);setConnection(`به‌روز شد · ${timeLabel(Date.now())}`,true);
      if(initial||result.messages.length)$('messages').scrollTop=$('messages').scrollHeight;
    }catch(error){if(error.status===401){leaveSession(false);return;}setConnection('اتصال قطع شد؛ دوباره تلاش می‌کنیم',false);}
    finally{polling=false;}
  }
  function startPolling(){clearInterval(timer);syncMessages(true);timer=setInterval(()=>syncMessages(false),4000);}
  function enterSession(username){me=username;$('myName').textContent=username;$('myAvatar').textContent=initials(username);showScreen('chat');startPolling();}
  async function checkSession(){try{const result=await api('/api/me');enterSession(result.username);}catch{showScreen('login');}}
  async function leaveSession(callApi=true){clearInterval(timer);timer=null;const oldMe=me;me=null;lastId=0;$('messages').replaceChildren();const empty=document.createElement('div');empty.id='chatEmpty';empty.className='chat-empty';empty.innerHTML='<span>☕</span><strong>هنوز کسی چیزی نگفته</strong><small>اولین سلام با تو!</small>';$('messages').append(empty);if(callApi)try{await api('/api/logout',{method:'POST',body:'{}'});}catch{}showScreen('login');$('password').value='';$('username').value=oldMe||'';}

  $('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();if(pending)return;pending=true;$('loginError').textContent='';$('loginSubmit').disabled=true;$('loginSubmit').textContent='در حال ورود…';
    try{const result=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});$('password').value='';enterSession(result.username);}
    catch(error){$('loginError').textContent=error.status?error.message:'اتصال به اتاق برقرار نشد. اینترنت را بررسی و دوباره تلاش کن.';$('password').value='';}
    finally{pending=false;$('loginSubmit').disabled=false;$('loginSubmit').innerHTML='ورود به اتاق <span>←</span>';}
  });
  $('logoutBtn').addEventListener('click',()=>leaveSession(true));
  $('refreshBtn').addEventListener('click',()=>{const button=$('refreshBtn');if(button.animate)button.animate([{transform:'rotate(0)'},{transform:'rotate(360deg)'}],{duration:450,easing:'ease-out'});syncMessages(false);});
  const input=$('messageInput');
  input.addEventListener('input',()=>{input.rows=Math.min(5,Math.max(1,input.value.split('\n').length,Math.ceil(input.value.length/82)));$('sendBtn').disabled=!input.value.trim();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('messageForm').requestSubmit();}});
  $('messageForm').addEventListener('submit',async event=>{
    event.preventDefault();const text=input.value.trim();if(!text||pending)return;pending=true;$('sendBtn').disabled=true;
    try{const result=await api('/api/messages',{method:'POST',body:JSON.stringify({text})});if(result.message)appendMessage(result.message);input.value='';input.rows=1;$('messages').scrollTop=$('messages').scrollHeight;syncMessages(false);}
    catch(error){if(error.status===401)leaveSession(false);else showToast(error.status?error.message:'ارسال انجام نشد؛ اتصال اینترنت را بررسی کن.');}
    finally{pending=false;$('sendBtn').disabled=!input.value.trim();input.focus();}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me)syncMessages(false);});
  if(reduceMotion)document.documentElement.classList.add('reduce-motion');
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
  checkSession();
})();
