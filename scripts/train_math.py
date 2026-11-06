import json
from pathlib import Path
import numpy as np

rng = np.random.default_rng(20261105)
rows = np.array([(op,a,b) for op in range(2) for a in range(100) for b in range(100)], dtype=int)
ids = list(range(20000))
state = 20261105
for i in range(19999,0,-1):
    state = (1664525*state+1013904223)&0xffffffff
    j = state%(i+1)
    ids[i],ids[j] = ids[j],ids[i]
selected = rows[ids[:2000]]
train, test = selected[:1600], selected[1600:]
weights = rng.normal(0,.1,(2,3))
initial = weights.copy()
losses = []
for step in range(3000):
    loss = 0.
    for op in range(2):
        batch = train[train[:,0] == op]
        x = np.column_stack((batch[:,1]/100, batch[:,2]/100, np.ones(len(batch))))
        y = (batch[:,1]+batch[:,2] if op == 0 else batch[:,1]-batch[:,2])/100
        err = x@weights[op]-y
        loss += float(np.mean(err**2))/2
        weights[op] -= .2*(2/len(batch))*(x.T@err)
    if step in [0,9,99,499,999,2999]:
        losses.append({'step':step+1, 'normalizedMSE':loss})
def metrics(batch):
    x = np.column_stack((batch[:,1]/100, batch[:,2]/100, np.ones(len(batch))))
    pred = np.sum(x*weights[batch[:,0]], axis=1)*100
    expected = np.where(batch[:,0] == 0, batch[:,1]+batch[:,2], batch[:,1]-batch[:,2])
    actual = np.floor(pred+.5).astype(int)
    return {'count':len(batch), 'exactMatches':int(np.sum(actual == expected)), 'accuracy':float(np.mean(actual == expected)), 'meanAbsoluteRawError':float(np.mean(abs(pred-expected))), 'maxAbsoluteRawError':float(np.max(abs(pred-expected)))}
checkpoint = {'format':'forge-math-linear-v1','modelId':'forge-math-tiny-v1','inputRange':[0,99],'scale':100,'weights':weights.tolist(),'training':{'seed':20261105,'steps':3000,'learningRate':.2,'trainCount':1600,'testCount':400,'initialWeights':initial.tolist(),'lossHistory':losses},'evaluation':{'train':metrics(train),'heldOut':metrics(test),'fullDomain':metrics(rows)},'limitations':'Two operator-specific linear regression heads; six learned parameters. Not a language model. Integer addition/subtraction only. No owner-authored rules supplied.','dataset':{'algorithm':'lcg-fisher-yates-v1','seed':20261105}}
path = Path(__file__).resolve().parents[1]/'docs'/'math-checkpoint.json'
path.write_text(json.dumps(checkpoint,separators=(',',':'))+'\n')
print(json.dumps(checkpoint['evaluation'],indent=2))
