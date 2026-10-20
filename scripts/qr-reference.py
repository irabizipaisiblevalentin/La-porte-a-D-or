# Independent reference: compute byte-mode version-1-M data+EC codewords
# for "HELLO WORLD" following ISO/IEC 18004.
EXP=[0]*512; LOG=[0]*256
v=1
for i in range(255):
    EXP[i]=v; LOG[v]=i
    v<<=1
    if v & 0x100: v ^= 0x11d
for i in range(255,512): EXP[i]=EXP[i-255]
def mul(a,b):
    if a==0 or b==0: return 0
    return EXP[LOG[a]+LOG[b]]

def gen(deg):
    p=[1]
    for i in range(deg):
        n=[0]*(len(p)+1)
        for j in range(len(p)):
            n[j]^=p[j]
            n[j+1]^=mul(p[j],EXP[i])
        p=n
    return p

def ec(data,deg):
    g=gen(deg)
    rem=[0]*deg
    for b in data:
        f=b^rem[0]
        rem=rem[1:]+[0]
        if f:
            for i in range(deg):
                rem[i]^=mul(g[i+1],f)
    return rem

msg=b"HELLO WORLD"
bits=[]
def push(val,n):
    for i in range(n-1,-1,-1): bits.append((val>>i)&1)
push(0b0100,4)
push(len(msg),8)
for b in msg: push(b,8)
# terminator
push(0,min(4, 16*8-len(bits)))
while len(bits)%8: push(0,1)
data=[]
for i in range(0,len(bits),8):
    byte=0
    for j in range(8): byte=(byte<<1)|bits[i+j]
    data.append(byte)
pad=[0xec,0x11]; k=0
while len(data)<16:
    data.append(pad[k%2]); k+=1
print("data codewords:", data)
print("ec codewords  :", ec(data,10))
print("rs generator  :", gen(10))

print()
print("=== version 2-M, 'Uwizihiwe Josiane' ===")
msg2="Uwizihiwe Josiane".encode()
bits=[]
push(0b0100,4); push(len(msg2),8)
for b in msg2: push(b,8)
push(0,min(4, 28*8-len(bits)))
while len(bits)%8: push(0,1)
d2=[]
for i in range(0,len(bits),8):
    byte=0
    for j in range(8): byte=(byte<<1)|bits[i+j]
    d2.append(byte)
k=0
while len(d2)<28:
    d2.append(pad[k%2]); k+=1
print("data:", d2)
print("ec  :", ec(d2,16))

# ---------------------------------------------------------------------------
# This script is the independent reference behind server/test/unit/qr.test.ts.
#
# It exists so the QR encoder can be checked against ISO/IEC 18004 rather than
# against itself: run it and compare the printed codewords with the constants in
# the test. A QR code that is almost right scans as nothing at all, so "it looks
# like a QR code" is not evidence.
# ---------------------------------------------------------------------------
