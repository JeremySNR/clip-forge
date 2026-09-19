import { describe, expect, it } from 'vitest'
import { validatedStoryIssue } from '../src/main/pipeline/visualScore'

describe('grounded story failure verdicts', () => {
  const transcript = 'Listen, Celia. I was young. And a dick. But there is no reason to destroy the world. Why does she do this? We already tried that one.'
  it('accepts a quoted unresolved exchange from the actual clip', () => {
    expect(validatedStoryIssue({kind:'unrelated_scene',evidence_quote:'We already tried that one.',reason:'A new scene introduces an unexplained prior attempt.'},transcript))
      .toEqual({kind:'unrelated_scene',evidenceQuote:'We already tried that one.',reason:'A new scene introduces an unexplained prior attempt.'})
  })
  it('rejects invented evidence, unsupported issue types, and missing reasons', () => {
    expect(validatedStoryIssue({kind:'unresolved_ending',evidence_quote:'How does the experiment end?',reason:'Unanswered.'},transcript)).toBeUndefined()
    expect(validatedStoryIssue({kind:'boring',evidence_quote:'We already tried that one.',reason:'Slow.'},transcript)).toBeUndefined()
    expect(validatedStoryIssue({kind:'unrelated_scene',evidence_quote:'We already tried that one.',reason:''},transcript)).toBeUndefined()
    expect(validatedStoryIssue({kind:'none',evidence_quote:'',reason:''},transcript)).toBeUndefined()
  })
  it('matches words with punctuation differences but never a substring inside another word', () => {
    expect(validatedStoryIssue({kind:'unresolved_ending',evidence_quote:'why does she do this',reason:'Unanswered.'},transcript)).toBeDefined()
    expect(validatedStoryIssue({kind:'unresolved_ending',evidence_quote:'ready tried that one',reason:'Unanswered.'},transcript)).toBeUndefined()
  })
})
