import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import './Onboarding.css';

const API_BASE = '/onboarding';

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  const studentId = searchParams.get('student');
  const campusId = searchParams.get('campus');

  const [studentName, setStudentName] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([]);           // display messages
  const [conversationHistory, setConversationHistory] = useState([]); // raw history with state comments
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState(1);

  // Completion state
  const [isComplete, setIsComplete] = useState(false);
  const [contextDocument, setContextDocument] = useState(null);
  const [copied, setCopied] = useState(false);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Fetch student info on mount
  useEffect(() => {
    if (!studentId || !campusId) {
      setLoadError('Missing student or campus in URL. Use /onboard?student=ID&campus=ID');
      return;
    }

    fetch(`${API_BASE}/student?studentId=${studentId}&campusId=${campusId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Student not found');
        return res.json();
      })
      .then((data) => {
        if (data.onboardingCompleted) {
          setLoadError('This student has already completed onboarding.');
          return;
        }
        setStudentName(data.name);
      })
      .catch((err) => setLoadError(err.message));
  }, [studentId, campusId]);

  // Send initial greeting once student is loaded
  useEffect(() => {
    if (studentName && messages.length === 0) {
      sendMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentName]);

  async function sendMessage(text) {
    // Add user message to display (skip for initial greeting)
    const newDisplayMessages = text
      ? [...messages, { role: 'user', content: text }]
      : [...messages];
    setMessages(newDisplayMessages);

    const newHistory = text
      ? [...conversationHistory, { role: 'user', content: text }]
      : [...conversationHistory];

    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          campusId,
          message: text,
          conversationHistory: newHistory,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }

      const data = await res.json();

      // Update display messages with assistant reply
      setMessages([...newDisplayMessages, { role: 'assistant', content: data.reply }]);

      // Update conversation history with raw reply (includes state comments)
      const rawReply = data._rawReply || data.reply;
      setConversationHistory([...newHistory, { role: 'assistant', content: rawReply }]);

      if (data.section) setSection(data.section);

      if (data.isComplete && data.contextDocument) {
        setIsComplete(true);
        setContextDocument(data.contextDocument);
      }
    } catch (err) {
      setMessages([
        ...newDisplayMessages,
        { role: 'assistant', content: `Something went wrong: ${err.message}. Try sending your message again.` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    sendMessage(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(contextDocument);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = contextDocument;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Auto-resize textarea
  function handleInputChange(e) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // Loading state
  if (!studentId || !campusId || loadError) {
    return <div className="onboarding-error">{loadError || 'Missing URL parameters'}</div>;
  }

  if (!studentName) {
    return <div className="onboarding-loading">Loading...</div>;
  }

  // Complete screen
  if (isComplete && contextDocument) {
    return (
      <div className="onboarding">
        <div className="onboarding-header">
          <h1>Student Onboarding</h1>
          <span className="progress">Complete</span>
        </div>
        <div className="complete-screen">
          <div className="complete-header">
            <h2>Your context is ready!</h2>
            <p>{studentName}'s content strategy profile has been saved.</p>
          </div>
          <button
            className={`copy-btn${copied ? ' copied' : ''}`}
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy Claude Project Context'}
          </button>
          <div className="context-doc">{contextDocument}</div>
          <div className="claude-note">
            To create this student's Claude Project: go to claude.ai/projects,
            create a new project, and paste this context into the project instructions field.
          </div>
        </div>
      </div>
    );
  }

  // Chat screen
  return (
    <div className="onboarding">
      <div className="onboarding-header">
        <h1>Student Onboarding</h1>
        <span className="progress">Section {section} of 6</span>
      </div>

      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {loading && <div className="typing">Thinking...</div>}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-bar" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer..."
          rows={1}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
