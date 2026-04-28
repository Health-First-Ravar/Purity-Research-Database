// Shared routing: topic_category → branch id.
// Used by /api/atlas (build the graph) and /api/atlas/unmapped (find what
// the regex misses so the editor can teach the atlas).

export function topicToBranchHardcoded(topic: string | null): string | null {
  if (!topic) return null;
  const t = topic.toLowerCase();

  if (/(pharmaco|cyp1a2|cyp3a4|adenosine|receptor|gene expression|epigenetic|telomere|circadian|melatonin|endothelial|molecular mechanism|metaboli[sz]m\b|drug interaction|drug-drug)/.test(t)) return 'b:mechanism';
  if (/(performance|ergogenic|athletic|endurance|exercise|sports|doping)/.test(t)) return 'b:performance';

  if (/(ochratoxin|aflatoxin|mycotoxin|fumonisin)/.test(t))        return 'b:mycotoxin';
  if (/(acrylamide|furan|\bpah\b)/.test(t))                        return 'b:contaminant';
  if (/(lead|cadmium|arsenic|mercury|heavy metal)/.test(t))        return 'b:metals';

  if (/(chlorogenic|cga|melanoidin|trigonelline|polyphenol|caffeine|diterpene|phytochemical|antioxidant|cafestol|kahweol)/.test(t)) return 'b:bioactives';
  if (/(roast|maillard)/.test(t))                                  return 'b:roast';
  if (/(brew|extract|grind|\bwater\b)/.test(t))                    return 'b:brew';

  if (/(soil|microbio|mycorrhiz|rhizo)/.test(t))                   return 'b:soil';
  if (/(agriculture|farming|cultivat|varietal|altitude|shade|terroir)/.test(t)) return 'b:agriculture';
  if (/(sourcing|trade|certif|sustain|climate)/.test(t))           return 'b:sourcing';
  if (/(process|washed|natural|honey|fermentation|drying)/.test(t)) return 'b:process';

  if (/(culture|history|ritual|caf[eé])/.test(t))                  return 'b:culture';

  // Body systems
  if (/(cancer|carcinog|tumor|oncolog|leukem|lymphom|hcc|hepatocellular)/.test(t)) return 'b:oncology';
  if (/(parkinson|alzheim|dementia|cognit|depression|mental|migraine|headache|neuro|adhd|sleep apnea)/.test(t)) return 'b:neurological';
  if (/(longevity|all-cause|mortality)/.test(t))                   return 'b:longevity';
  if (/(cardio|cardiovasc|stroke|heart|hypertension|atrial|coronary|endothelial|vascular|cholesterol|lipid|triglyceride)/.test(t)) return 'b:cardiovascular';
  if (/(diabetes|t2d|metabolic|glycem|insulin|obesity|bmi|gout|uric acid)/.test(t)) return 'b:metabolic';
  if (/(thyroid|tsh|cortisol|testosterone|estrogen|hpa|adrenal|pituitary|hormone)/.test(t)) return 'b:metabolic';
  if (/(liver|hepat|nafld|cirrhosis)/.test(t))                     return 'b:hepatic';
  if (/(gut|gi|gastro|intestin|bifido|colorectal|ibs|colitis)/.test(t)) return 'b:hepatic';
  if (/(kidney|renal|ckd|nephr|urinary)/.test(t))                  return 'b:renal';
  if (/(bone|osteoporo|osteo|fracture|skeletal|bmd|joint|muscle|sarcopenia)/.test(t)) return 'b:musculoskeletal';
  if (/(pregnancy|miscarriage|birth weight|fetal|fertility|reproduct|erectile|sexual|prostate|breast)/.test(t)) return 'b:reproductive';
  if (/(immune|inflammation|crp|il-?6|cytokine|t cell|b cell|nk cell|immunolog|allerg|autoimmun)/.test(t)) return 'b:immune';
  if (/(macular|vision|eye|hearing|tinnitus|auditory|skin|dermato|dental|tooth|enamel|wound|collagen|fibroblast|hair)/.test(t)) return 'b:sensory';
  if (/(safety|toxicol|adverse)/.test(t))                          return 'b:longevity';
  if (/(taste|bitter|tas2r)/.test(t))                              return 'b:bioactives';

  return null;
}
