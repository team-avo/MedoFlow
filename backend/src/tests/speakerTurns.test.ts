/**
 * CTO-41: splitting a live caption into speaker turns.
 *
 * The rules that matter clinically are the negative ones: dictated prose must
 * not be mistaken for a speaker change, and unlabelled text must come back as
 * `speaker: null` rather than being guessed at.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  MAX_SPEAKER_TURNS,
  parseSpeakerTurns,
  SPEAKER_TURN_INSTRUCTION,
} from '../services/ai/speakerTurns'

describe('parseSpeakerTurns', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    assert.deepEqual(parseSpeakerTurns(''), [])
    assert.deepEqual(parseSpeakerTurns('   \n\t  '), [])
  })

  it('text with no prefix is one unlabelled turn', () => {
    assert.deepEqual(parseSpeakerTurns('and magnesium glycinate at night.'), [
      { speaker: null, text: 'and magnesium glycinate at night.' },
    ])
  })

  it('a single labelled line becomes one labelled turn', () => {
    assert.deepEqual(parseSpeakerTurns('Provider: How have you been?'), [
      { speaker: 'PROVIDER', text: 'How have you been?' },
    ])
  })

  it('accepts a lowercase prefix at the start of a line', () => {
    assert.deepEqual(parseSpeakerTurns('patient: a little tired'), [
      { speaker: 'PATIENT', text: 'a little tired' },
    ])
  })

  it('accepts indentation before a prefix, because models indent dialogue', () => {
    assert.deepEqual(parseSpeakerTurns('  Provider: breathe in\n\t Patient: okay'), [
      { speaker: 'PROVIDER', text: 'breathe in' },
      { speaker: 'PATIENT', text: 'okay' },
    ])
  })

  it('accepts a space before the colon', () => {
    assert.deepEqual(parseSpeakerTurns('Provider : sit up please'), [
      { speaker: 'PROVIDER', text: 'sit up please' },
    ])
  })

  it('splits one turn per line', () => {
    assert.deepEqual(parseSpeakerTurns('Provider: Any pain?\nPatient: Only when I bend.'), [
      { speaker: 'PROVIDER', text: 'Any pain?' },
      { speaker: 'PATIENT', text: 'Only when I bend.' },
    ])
  })

  it('splits mid-line after a sentence ends', () => {
    assert.deepEqual(parseSpeakerTurns('Any pain? Patient: a little'), [
      { speaker: null, text: 'Any pain?' },
      { speaker: 'PATIENT', text: 'a little' },
    ])
  })

  it('splits mid-line after plain whitespace when the marker is capitalised', () => {
    assert.deepEqual(parseSpeakerTurns('okay Patient: I am tired'), [
      { speaker: null, text: 'okay' },
      { speaker: 'PATIENT', text: 'I am tired' },
    ])
  })

  it('does NOT split dictated prose that merely mentions the patient', () => {
    const dictated = 'I explained it to the patient: she said it started Tuesday.'
    assert.deepEqual(parseSpeakerTurns(dictated), [{ speaker: null, text: dictated }])
  })

  it('text before the first prefix continues the previous speaker, unlabelled', () => {
    assert.deepEqual(parseSpeakerTurns('two bottles should last.\nPatient: understood'), [
      { speaker: null, text: 'two bottles should last.' },
      { speaker: 'PATIENT', text: 'understood' },
    ])
  })

  it('normalises CRLF and drops blank lines between turns', () => {
    assert.deepEqual(parseSpeakerTurns('Provider: one\r\n\r\nPatient: two\r'), [
      { speaker: 'PROVIDER', text: 'one' },
      { speaker: 'PATIENT', text: 'two' },
    ])
  })

  it('preserves newlines inside a single turn', () => {
    assert.deepEqual(parseSpeakerTurns('Provider: take one\nthen rest'), [
      { speaker: 'PROVIDER', text: 'take one\nthen rest' },
    ])
  })

  it('drops a prefix with no words after it', () => {
    assert.deepEqual(parseSpeakerTurns('Provider:'), [])
    assert.deepEqual(parseSpeakerTurns('Provider:\nPatient: hello'), [
      { speaker: 'PATIENT', text: 'hello' },
    ])
  })

  it('keeps consecutive turns from the same speaker separate', () => {
    assert.deepEqual(parseSpeakerTurns('Provider: one\nProvider: two'), [
      { speaker: 'PROVIDER', text: 'one' },
      { speaker: 'PROVIDER', text: 'two' },
    ])
  })

  it('stays bounded when a model spews prefixes', () => {
    const many = Array.from({ length: MAX_SPEAKER_TURNS + 40 }, (_, i) =>
      i % 2 === 0 ? `Provider: line ${i}` : `Patient: line ${i}`
    ).join('\n')
    const turns = parseSpeakerTurns(many)
    // At most the cap of labelled turns, plus an optional unlabelled preamble.
    assert.ok(turns.length <= MAX_SPEAKER_TURNS + 1, `got ${turns.length}`)
    // Nothing is lost: the markers past the cap stay as text in the last turn.
    assert.match(turns[turns.length - 1]!.text, /line 59$/)
  })
})

describe('SPEAKER_TURN_INSTRUCTION', () => {
  it('asks for the two prefixes and forbids guessing', () => {
    assert.match(SPEAKER_TURN_INSTRUCTION, /"Provider:"/)
    assert.match(SPEAKER_TURN_INSTRUCTION, /"Patient:"/)
    assert.match(SPEAKER_TURN_INSTRUCTION, /never guess/i)
    assert.match(SPEAKER_TURN_INSTRUCTION, /no prefix/i)
  })
})
