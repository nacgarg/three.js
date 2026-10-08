import { getShadowReference } from '../../../../../src/nodes/lighting/ShadowFilterNode.js';
import { renderGroup } from '../../../../../src/nodes/core/UniformGroupNode.js';
import { LightShadow } from '../../../../../src/lights/LightShadow.js';
import { OrthographicCamera } from '../../../../../src/cameras/OrthographicCamera.js';

export default QUnit.module( 'Nodes', () => {

	QUnit.module( 'Lighting', () => {

		QUnit.module( 'ShadowFilterNode', () => {

			QUnit.test( 'getShadowReference returns one render-group node per shadow and property', ( assert ) => {

				const shadowA = new LightShadow( new OrthographicCamera() );
				const shadowB = new LightShadow( new OrthographicCamera() );

				const radius = getShadowReference( 'radius', 'float', shadowA );

				assert.strictEqual( getShadowReference( 'radius', 'float', shadowA ), radius, 'Same node for the same shadow and property.' );
				assert.notStrictEqual( getShadowReference( 'radius', 'float', shadowB ), radius, 'Another node for another shadow.' );
				assert.notStrictEqual( getShadowReference( 'mapSize', 'vec2', shadowA ), radius, 'Another node for another property.' );
				assert.strictEqual( radius.group, renderGroup, 'The node belongs to the render group.' );

			} );

		} );

	} );

} );
