const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');
const jsx = (type, props) => ({type, props});
function compile(file) {
  return babel.transformFileSync(file, {caller: {name:'metro', platform:'android', isDev:true}, plugins:['@babel/plugin-transform-modules-commonjs']}).code;
}
function load(file, imports, append='', globals={}) {
  const exports={};
  vm.runInNewContext(compile(file)+append,{exports,require(name){
    if(Object.hasOwn(imports,name))return imports[name];
    if(name.startsWith('@babel/runtime/helpers/'))return require(name);
    throw Error(`Unexpected import ${name}`);
  },...globals});
  return exports;
}
let width=320, pathname='/', closeCalls=0, carouselIndex=0;
const actions={openSidebar(){},closeSidebar(){closeCalls++}};
const react={memo:fn=>fn,createContext:initial=>({initial}),useContext:ctx=>typeof ctx.initial==='boolean'?true:actions,
  useState:initial=>[typeof initial==='boolean'?true:initial===0?carouselIndex:initial,()=>{}],useCallback:fn=>fn,useMemo:fn=>fn(),useEffect(){},useRef:current=>({current})};
const native={View:'View',Text:'Text',Pressable:'Pressable',Modal:'Modal',ScrollView:'ScrollView',Share:{},
  useWindowDimensions:()=>({width,height:640}),StyleSheet:{create:s=>s,flatten:s=>Object.assign({},...[s].flat(Infinity).filter(Boolean))},
  Animated:{View:'AnimatedView',Text:'AnimatedText',Value:class{interpolate(){return 0}}},Easing:{}};
const theme=load('lib/theme.ts',{});
const {t}=load('lib/i18n.ts',{});
const imports={react,'react-native':native,'react/jsx-runtime':{jsx,jsxs:jsx},'react/jsx-dev-runtime':{jsxDEV:jsx},
  'expo-image':{Image:'Image'},'expo-router':{router:{},usePathname:()=>pathname},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:24,bottom:20,left:0,right:0})},
  '@expo/vector-icons':{Ionicons:'Icon'},'expo-linear-gradient':{LinearGradient:'Gradient'},
  '../lib/auth':{useAuth:()=>({user:null,isConfigured:false})},'../lib/presence':{isAdmin:()=>false},
  '../lib/history':{},'../lib/favorites':{},'../lib/theme':theme,'../lib/i18n':{t},
  'expo-constants':{expoConfig:{version:'test'}},'expo-application':{},'../assets/icon.png':'bundled-app-logo', '../lib/motion':{useReducedMotion:()=>true}};
const {drawer}=load('components/Sidebar.tsx',imports,'\nexports.drawer = Sidebar;');
function walk(node){
  if(!node||typeof node!=='object')return [];
  return [node,...[node.props?.children].flat(Infinity).flatMap(walk)];
}
function style(node){const s=typeof node.props.style==='function'?node.props.style({pressed:false}):node.props.style;
  return Object.assign({},...[s].flat(Infinity).filter(Boolean));}
for(width of [320,390,800]){
  const tree=drawer();
  assert.equal(tree.type,'Modal','drawer must sit above native navigation and handle Android Back');
  tree.props.onRequestClose();
  const nodes=walk(tree);
  const panel=nodes.find(n=>style(n).right===0&&style(n).backgroundColor===theme.C.surfaceContainer);
  assert.ok(panel,'drawer panel missing');
  assert.ok(style(panel).width<=width-32&&style(panel).width<=380,'drawer must fit and leave a reachable backdrop');
  assert.ok(nodes.some(n=>n.type==='Image'&&n.props.source==='bundled-app-logo'),'drawer must show the actual app icon');
  assert.ok(nodes.some(n=>n.type==='ScrollView'),'all navigation groups must be reachable on short screens');
  const rows=nodes.filter(n=>n.props.accessibilityState);
  for(const row of rows){
    const s=style(row);
    assert.equal(s.flexDirection,'row','native callback must preserve horizontal drawer rows');
    assert.ok(s.minHeight>=48,'navigation targets must remain tappable');
    const children=row.props.children;
    const label=children.find(n=>n?.type==='Text');
    assert.equal(style(label).flex,1,'long labels need remaining row space');
    assert.equal(label.props.numberOfLines,undefined,'long navigation labels must wrap');
  }
}
assert.equal(closeCalls,3);
for(const [path,expected] of [['/',t.home],['/settings',t.settingsTitle],['/settings/archive',t.settingsTitle],['/settings-archive',null],['/manga',t.mangaTab],['/manga/story',t.mangaTab],['/manga-library',t.mangaLibrary]]){
  pathname=path;
  const selected=walk(drawer()).filter(n=>n.props.accessibilityState?.selected);
  assert.equal(selected.length,expected?1:0,`incorrect drawer selection at ${path}`);
  if(expected)assert.equal(selected[0].props.accessibilityLabel,expected);
}
// Periodic title motion must stop on blur, background, reduced motion and drawer opening.
let focus, onAppState, reduced=false, drawerOpen=false, removed=0, stopped=0, completion;
const timers=new Map(); let nextTimer=0;
const values=[];
const motionConfigs=[];
const animated={...native.Animated,
  Value:class{constructor(v){this.value=v;values.push(this)}setValue(v){this.value=v}interpolate(){return 0}},
  timing:(value,config)=>{motionConfigs.push(config);return {value,config}},spring:(value,config)=>{motionConfigs.push(config);return {value,config}},
  sequence:steps=>steps,stagger:(delay,steps)=>steps,
  parallel:steps=>({start:cb=>{completion=cb;values.forEach(v=>v.setValue(1))},stop:()=>{stopped++;completion?.({finished:false})}})};
const appState={currentState:'active',addEventListener:(_,cb)=>{onAppState=cb;return {remove(){removed++}}}};
const {PantoufaWordmark}=load('components/PantoufaWordmark.tsx',{
  ...imports,react:{...react,useFocusEffect:undefined},
  'react-native':{...native,Animated:animated,AppState:appState,Easing:{cubic:0,inOut:x=>x,out:x=>x}},
  'expo-router':{useFocusEffect:fn=>{focus=fn}},'./Sidebar':{useSidebar:()=>({open:drawerOpen})},
  '../lib/motion':{useReducedMotion:()=>reduced},
},'',{setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer},clearTimeout:id=>timers.delete(id)});
function nextTick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();return timer.ms}
const brand=PantoufaWordmark();
assert.equal(brand.props.accessibilityLabel,'Pantoufa');
assert.equal(walk(brand).filter(n=>n.type==='AnimatedText').length,8,'every title letter must remain visible');
const blur=focus();
assert.equal(timers.size,1);assert.equal(nextTick(),1800);
assert.ok(motionConfigs.every(c=>c.useNativeDriver&&c.isInteraction===false),'animation must not block feed interactions');
completion({finished:true});assert.equal(timers.size,1);
assert.equal([...timers.values()][0].ms,3000,'bursts should repeat after a three-second rest');
appState.currentState='background';onAppState('background');
assert.equal(timers.size,0);assert.ok(values.every(v=>v.value===0),'background must reset the title');
appState.currentState='active';onAppState('active');assert.equal(timers.size,1);
nextTick();blur();assert.equal(timers.size,0);assert.equal(removed,1);assert.ok(stopped>=2);
completion({finished:true});assert.equal(timers.size,0,'late completion after blur must not restart');
reduced=true;PantoufaWordmark();assert.equal(focus(),undefined);assert.equal(timers.size,0);
reduced=false;drawerOpen=true;PantoufaWordmark();assert.equal(focus(),undefined);assert.equal(timers.size,0);
// Only render the layout components. Their unused screen services stay inert.
function loadLayout(file, name) {
  const deps = Object.fromEntries([...compile(file).matchAll(/require\("([^"\n]+)"\)/g)].filter(m => !m[1].startsWith("@babel/runtime/" )).map(m => [m[1], {}]));
  return load(file, {...deps, ...imports, '../../lib/theme':theme, '../../lib/i18n':{t}, '../../lib/motion':imports['../lib/motion']}, '\nexports.layout = '+name+';').layout;
}
const Hero=loadLayout('app/(tabs)/index.tsx','HeroCarousel');
const Episode=loadLayout('app/anime/[id].tsx','EpisodeGridCard');
for(width of [320,390,800]) {
  carouselIndex=2;
  const hero=Hero({featured:Array.from({length:3},()=>({title:'A title',genres:[],href:'preview'}))});
  const scroll=walk(hero).find(n=>n.type==='ScrollView');
  let offset; scroll.props.ref.current={scrollTo:value=>{offset=value}};
  scroll.props.onLayout();
  assert.equal(offset.x,carouselIndex*width,'resizing must keep the selected hero slide aligned');
  assert.equal(offset.animated,false);
  const slide=walk(hero).find(n=>style(n).height===440 && style(n).width===width);
  assert.ok(slide,'hero must use the current viewport width, even after resize');
  const episode=Episode({ep:{number:1,href:'preview'},byNum:[]});
  const cardWidth=style(episode).width;
  assert.equal(cardWidth*2+10,width-theme.S.paddingContent*2,'two episode cards must fit the current content width');
}
console.log('Android UI: real drawer logo, navigation, sizing, Back, live widths and title animation lifecycle passed');


