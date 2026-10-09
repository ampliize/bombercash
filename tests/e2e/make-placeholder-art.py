"""Gera arte PROVISÓRIA (mesma composição da arte final) só para testar a tela inicial animada.
Uso: python3 make-placeholder-art.py <pasta-de-saida>   -> splash-h.webp e splash-v.webp
A arte real (fornecida pelo designer) deve ficar em demo/assets/splash-h.webp e demo/assets/splash-v.webp."""
import sys,os,random
from PIL import Image,ImageDraw,ImageFont
out=sys.argv[1] if len(sys.argv)>1 else '.'
os.makedirs(out,exist_ok=True)
F=lambda n:ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',n)
def grad(w,h,c1,c2):
    im=Image.new('RGB',(w,h));d=ImageDraw.Draw(im)
    for y in range(h):
        t=y/h;d.line([(0,y),(w,y)],fill=tuple(int(c1[i]+(c2[i]-c1[i])*t) for i in range(3)))
    return im
def text_outline(d,xy,txt,font,fill,out,ow=6):
    x,y=xy
    for dx in range(-ow,ow+1,2):
        for dy in range(-ow,ow+1,2):d.text((x+dx,y+dy),txt,font=font,fill=out,anchor='mm')
    d.text(xy,txt,font=font,fill=fill,anchor='mm')
def make(w,h,port):
    random.seed(7);im=grad(w,h,(30,150,255),(190,235,255));d=ImageDraw.Draw(im)
    # ambiente: arquibancada colorida e caixas
    for i in range(0,w,w//10):
        for j in range(int(h*.38),h,h//14):
            c=random.choice([(124,58,237),(236,72,153),(250,204,21),(59,130,246),(34,197,94)]);d.rectangle([i,j,i+w//11,j+h//15],fill=c)
    cw=int(w*(.78 if port else .42));cx=w//2;top=int(h*(.18 if port else .06))
    # gabinete roxo
    d.rounded_rectangle([cx-cw//2,top,cx+cw//2,h],radius=40,fill=(76,29,149),outline=(30,12,70),width=8)
    # logo
    ly=int(h*(.23 if port else .16));fs=int(w*(.125 if port else .06))
    text_outline(d,(cx,ly-fs//2),'BOMBER',F(fs),(255,153,0),(60,20,0));text_outline(d,(cx,ly+fs//2),'CASH',F(int(fs*1.1)),(255,205,40),(60,20,0))
    # faixa arena
    by=int(h*(.35 if port else .325));d.rounded_rectangle([cx-int(cw*.45),by-26,cx+int(cw*.45),by+26],radius=10,fill=(12,12,40));d.text((cx,by),'ARENA DE HABILIDADE',font=F(int(w*(.04 if port else .022))),fill=(255,205,60),anchor='mm')
    # tela do jogo
    sx0,sx1=cx-int(cw*.42),cx+int(cw*.42);sy0=int(h*(.39 if port else .385));sy1=int(h*(.64 if port else .745))
    d.rectangle([sx0,sy0,sx1,sy1],fill=(40,30,60));
    n=15;m=11;tw=(sx1-sx0-30)/n;th=(sy1-sy0-30)/m
    for a in range(n):
        for b in range(m):
            c=(240,150,40) if (a+b)%2 else (225,135,30)
            if a%2==1 and b%2==1:c=(150,150,160)
            elif random.random()<.18:c=(170,110,40)
            d.rectangle([sx0+15+a*tw,sy0+15+b*th,sx0+15+(a+1)*tw-2,sy0+15+(b+1)*th-2],fill=c)
    for (a,b,c) in [(1,1,(60,140,255)),(11,2,(230,50,60)),(3,7,(60,200,90)),(12,8,(240,200,60)),(8,5,(230,80,200))]:
        d.ellipse([sx0+15+a*tw+4,sy0+15+b*th+4,sx0+15+(a+1)*tw-4,sy0+15+(b+1)*th-4],fill=c)
    # painel com JOGUE AGORA
    py=int(h*(.69 if port else .835));d.rounded_rectangle([cx-int(cw*.2),py-int(h*.04),cx+int(cw*.2),py+int(h*.04)],radius=12,fill=(15,10,35),outline=(255,205,60),width=3)
    d.text((cx,py),'JOGUE AGORA',font=F(int(w*(.03 if port else .016))),fill=(255,205,60),anchor='mm')
    d.ellipse([cx-int(cw*.4)-30,py-30,cx-int(cw*.4)+30,py+30],fill=(40,110,240));d.ellipse([cx+int(cw*.4)-30,py-30,cx+int(cw*.4)+30,py+30],fill=(230,30,50))
    if port:
        by2=int(h*.84);d.rounded_rectangle([int(w*.06),by2-int(h*.06),int(w*.94),by2+int(h*.06)],radius=16,fill=(16,16,40),outline=(255,205,0),width=6)
        d.ellipse([int(w*.1),by2-int(h*.05),int(w*.1)+int(h*.1),by2+int(h*.05)],fill=(220,20,40));d.text((int(w*.1)+int(h*.05),by2),'18+',font=F(int(w*.07)),fill='white',anchor='mm')
        d.text((int(w*.62),by2),'PROIBIDO PARA\nMENORES DE 18 ANOS',font=F(int(w*.05)),fill='white',anchor='mm',align='center')
    # bombas nos cantos e marca
    for (bx,by_) in [(0,h),(w,h)]:d.ellipse([bx-w//9,by_-w//9,bx+w//9,by_+w//9],fill=(20,30,90))
    d.text((12,12),'ARTE PROVISORIA (teste)',font=F(18),fill=(255,255,255))
    return im
make(1672,941,False).save(os.path.join(out,'splash-h.webp'),quality=80)
make(941,1672,True).save(os.path.join(out,'splash-v.webp'),quality=80)
print('ok',out)
