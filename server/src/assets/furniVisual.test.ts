import { describe, expect, it } from 'vitest';
import { parseFurniAssets, parseFurniVisualization } from './furniVisual.js';

const VIS = `<?xml version="1.0"?>
<visualizationData type="lamp"><graphics>
  <visualization size="32" layerCount="1"><layers/></visualization>
  <visualization size="64" layerCount="3" angle="45">
    <layers>
      <layer id="1" alpha="153"/>
      <layer id="2" ink="ADD" ignoreMouse="1" z="4"/>
    </layers>
    <directions>
      <direction id="0"><layer id="1" x="16" y="-6" z="-100"/></direction>
      <direction id="2"/>
    </directions>
    <colors>
      <color id="2"><colorLayer id="0" color="525252"/></color>
    </colors>
    <animations>
      <animation id="0">
        <animationLayer id="0"><frameSequence><frame id="0"/></frameSequence></animationLayer>
      </animation>
      <animation id="1">
        <animationLayer id="1" loopCount="0" frameRepeat="4">
          <frameSequence><frame id="1"/><frame id="2" x="1" y="-2"/></frameSequence>
          <frameSequence random="1"><frame id="3"/></frameSequence>
        </animationLayer>
      </animation>
      <animation id="-1">
        <animationLayer id="2" loopCount="2"><frameSequence><frame id="7"/></frameSequence></animationLayer>
      </animation>
    </animations>
  </visualization>
</graphics></visualizationData>`;

describe('conversão de móveis por camadas', () => {
  it('lê só a visualização de 64 px: camadas, direções, cores e animações', () => {
    const v = parseFurniVisualization(VIS);
    expect(v.layerCount).toBe(3);
    expect(v.layers).toEqual({ '1': { alpha: 153 }, '2': { ink: 33, ignoreMouse: 1, z: 4 } });
    expect(v.directions).toEqual({ '0': { '1': { x: 16, y: -6, z: -100 } }, '2': {} });
    expect(v.colors).toEqual({ '2': { '0': 0x525252 } });
    expect(v.animations['1']!['1']).toEqual({
      frameRepeat: 4,
      random: 1,
      frames: [{ id: 1 }, { id: 2, x: 1, y: -2 }, { id: 3 }],
    });
    expect(v.animations['-1']!['2']).toEqual({ loopCount: 2, frames: [{ id: 7 }] });
  });

  it('sem visualização de 64 px é erro', () => {
    expect(() => parseFurniVisualization('<visualization size="32" layerCount="1"/>')).toThrow();
  });

  it('assets de 64 px com apelido e espelhamento (aspas simples ou duplas)', () => {
    const a = parseFurniAssets(`<assets>
      <asset name="lamp_32_a_0_0" x="1" y="2"/>
      <asset name="lamp_64_a_0_0" flipH="1" source="lamp_64_a_6_0" x="17" y="61"/>
      <asset name='lamp_64_a_6_0' x='-3' y='61'/>
    </assets>`);
    expect(a).toEqual({
      lamp_64_a_0_0: { x: 17, y: 61, source: 'lamp_64_a_6_0', flip: 1 },
      lamp_64_a_6_0: { x: -3, y: 61 },
    });
  });
});
