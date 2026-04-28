# Before / after — the new chat prompt in action

Same retrieval, same model, different system prompt + escalation rubric.

---

## 1. "Is PROTECT good for someone with acid reflux?"

### BEFORE (live screenshot, 2026-04-27)
> Honestly, I don't have the specific evidence in front of me right now to give
> you a precise, well-sourced answer about PROTECT and acid reflux — and I'd
> rather be straight with you than speculate. What I can say generally: PROTECT
> is a lighter roast, and roast level does interact with acidity and stomach
> tolerance in ways that vary quite a bit person to person. If low acid is the
> primary concern, our **EASE** blend is specifically formulated with that in
> mind — it's a darker roast designed to be gentler on the stomach. That might
> be worth a closer look depending on your situation. For anything touching on
> a specific GI condition like acid reflux, it's genuinely worth looping in
> your healthcare provider — they'll know your full picture. In the meantime,
> I'd love to get Ildi or Jeremy to follow up with more detailed sourcing on
> PROTECT's acidity profile so you can make a fully informed call.
>
> *confidence 0.10 · escalated to Ildi / Jeremy*

**Problems:** apologetic opener, buries the recommendation, escalates
unnecessarily, confidence 0.10 on a question the framework answers cleanly.

### AFTER (target output)
> Reach for **EASE** rather than PROTECT if reflux is a regular concern. EASE
> is our darker roast and that roast development generates more NMP
> (N-methylpyridinium) from trigonelline, which research suggests is
> associated with reduced gastric acid stimulation. That's the compound story
> behind why a darker roast tends to sit better on a sensitive stomach, even
> though "darker = harsher" is the common misconception.
>
> PROTECT is on the lighter end and preserves more of the chlorogenic acids,
> which are great for an antioxidant-forward profile but are part of why
> lighter roasts can be sharper on a reflux-prone stomach. If you specifically
> want PROTECT for the antioxidant story, brewing it with a paper filter and
> avoiding it on an empty stomach are the two levers that help most.
>
> If your reflux is severe or you're on medication for it, that's worth a
> conversation with your GI provider on top of any blend choice. Coffee is one
> input among many, and they can help you sort the full picture.
>
> *confidence 0.85 · NOT escalated*

**Why it works:** answer in sentence one, mechanism in two sentences, the
"lighter is healthier" trap addressed honestly, escalation reserved for the
medication conversation.

---

## 2. "Is Swiss Water decaf actually chemical-free?"

### BEFORE (likely current behavior — apologetic)
> That's a great question. Swiss Water Process is widely considered one of the
> cleaner decaffeination methods... I'd want Ildi or Jeremy to follow up with
> the specific certification details before giving you a definitive answer.

### AFTER (target)
> Yes, in the everyday meaning of the phrase. Swiss Water Process uses water
> and a green coffee extract (GCE) saturated with the soluble compounds you
> want to keep. The water draws caffeine out across an activated-carbon
> filter; no methylene chloride, no ethyl acetate, no chemical solvents in
> contact with the bean. CALM is decaffeinated this way and tests at roughly
> 99.9% caffeine-free.
>
> The honest caveat: "chemical-free" is a marketing phrase rather than a
> technical one. Water is a chemical, caffeine is a chemical. What Swiss
> Water actually means is solvent-free decaf, and that's the meaningful
> distinction versus methylene chloride and ethyl acetate decafs that still
> dominate the commodity end of the market.
>
> *confidence 0.92 · NOT escalated*

---

## 3. "What's the CGA level in FLOW?"

### BEFORE
> I don't have that specific value in front of me. CGAs are typically...
> *escalated*

### AFTER (target — this one SHOULD escalate)
> CGA levels vary lot to lot because they're driven by green coffee origin,
> water activity at receipt, and how the roast develops. FLOW is a balanced
> roast, so it sits between PROTECT (lighter, highest CGA preservation) and
> EASE (darker, more transformed). I don't have the most recent FLOW lot's
> exact mg/g number in front of me, so I'm flagging this for Jeremy to pull
> the latest COA and follow up with the precise number for the lot you have.
>
> *confidence 0.55 · escalated · reason: specific_data_missing*

**Why escalation is right here:** customer asked for a specific lab number
on a specific blend. That's exactly condition (a) in the new prompt. The
framework answer goes out immediately, the precise number comes via Jeremy.

---

## 4. "Does coffee cause cancer?"

### AFTER (target)
> The opposite, in the directions where the evidence is strongest. The IARC
> reclassified coffee out of the Group 2B "possibly carcinogenic" category in
> 2016, and the FDA's December 2024 review recognized coffee as compatible
> with a healthy dietary pattern. Coffee consumption is associated with
> reduced risk of liver cancer, endometrial cancer, and (in some prospective
> cohorts) colorectal cancer.
>
> The one compound worth knowing about is acrylamide, which forms during
> roasting via the Maillard reaction and peaks at medium roast. EFSA
> classifies acrylamide as a probable human carcinogen based on animal data,
> though the human epidemiology specifically for coffee acrylamide intake has
> been inconsistent. Purity tests acrylamide on every lot and roasts to
> manage the curve, which is part of why the contaminant story matters as
> much as the bioactive story in the health-first category.
>
> *confidence 0.90 · NOT escalated*

---

## 5. "I'm pregnant — can I drink Purity?"

### AFTER (target — escalates correctly for personalization)
> Most prenatal guidance caps caffeine at 200 mg per day, which is roughly
> one to two 8 oz cups depending on roast and brew method. CALM is our Swiss
> Water decaf and removes that variable entirely if you'd rather not track.
> If you want some caffeine, EASE tends to be the gentler choice during
> pregnancy because the darker roast profile sits better on a stomach that's
> already navigating reflux changes.
>
> Pregnancy is one of the cases where I'd defer to your OB on the specific
> daily cap rather than landing on a number for you, since CYP1A2
> metabolism, blood pressure baseline, and trimester all shift the picture.
> I'm flagging this for Ildi or Jeremy to follow up with anything else
> specific to your situation.
>
> *confidence 0.70 · escalated · reason: pregnancy_personalization*

---

## What to verify after deploy

Open `/chat` and run all five prompts above. The first four should match
"after" within tone reasonable variation; the fifth and the FLOW-CGA case
should escalate. If any of them still escalates incorrectly, check the route
patch and the `escalation_recommended` boolean in the model's structured
return — that's the lever to tune from.
