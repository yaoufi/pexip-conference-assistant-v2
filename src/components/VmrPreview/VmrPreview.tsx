  import { useState } from 'react'
  import { Box, BoxHeader, Button } from '@pexip/components'

  interface VmrPreviewProps {
    node: string
    conference: string
    pin: string
  }

  export const VmrPreview = ({ node, conference, pin }: VmrPreviewProps): JSX.Element => {
    const [isStarted, setIsStarted] = useState(false)

    const previewUrl = (node && conference)
      ? `https://${node}/?conference=${encodeURIComponent(conference)}&name=API-Preview&callType=AudioRecvVideoRecvPresentationRecv&join=1${pin ? `&pin=${encodeURIComponent(pin)}&role=host` : ''}`
      : null

    const handleStart = () => {
      setIsStarted(true)
    }

    return (
      <Box colorScheme="light" style={{ padding: '0', overflow: 'hidden' }}>
        <BoxHeader>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            width: '100%'
          }}>
            {/* Empty div to balance the grid for centering */}
            <div />

            <h3 style={{ margin: 0, textAlign: 'center' }}>Live VMR Preview</h3>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {isStarted && (
                <Button variant="secondary" onClick={() => setIsStarted(false)}>
                  Stop Preview
                </Button>
              )}
            </div>
          </div>
        </BoxHeader>

        <div style={{
          width: '100%',
          height: '320px',
          background: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          {!isStarted ? (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <p style={{ color: '#ccc', marginBottom: '12px' }}>Video monitoring is currently disabled.</p>
              <Button onClick={handleStart} colorScheme="dark">
                Start Preview
              </Button>
            </div>
          ) : (
            previewUrl ? (
              <iframe
                src={previewUrl}
                title="Pexip VMR Preview"
                width="100%"
                height="100%"
                frameBorder="0"
                allow="camera; microphone; display-capture; autoplay"
                style={{ display: 'block' }}
              />
            ) : (
              <div style={{ color: '#fff' }}>Configuration missing.</div>
            )
          )}
        </div>
      </Box>
    )
  }
