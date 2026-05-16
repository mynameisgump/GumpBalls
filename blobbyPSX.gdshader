shader_type spatial;
render_mode skip_vertex_transform, unshaded, diffuse_lambert_wrap, depth_draw_always;
// vertex_lighting, unshaded
uniform sampler2D albedo;
uniform sampler2D normal;
uniform float normal_strength = 1.0; // Adjusts the intensity of the normal map
uniform sampler2D specular;
uniform sampler2D emission;

uniform float jitter: hint_range(0.0, 1.0) = 0.5;
uniform bool jitter_z_coordinate = true;
uniform bool jitter_depth_independent = true;
uniform bool affine_texture_mapping = true;
uniform float alpha_scissor: hint_range(0.0, 1.0) = 1.0;

uniform float uv_tiling = 1.0; // Scale the UVs for tiling the texture



// Uniforms to control the effect
uniform float intensity = 0.3; // Strength of the lumpiness
uniform float speed = 1.0; // Speed of the movement
uniform float frequency = 5.0; // Frequency of the lumps

// Noise function for organic movement
vec3 hash(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    return mix(mix(mix(dot(hash(i + vec3(0, 0, 0)), f - vec3(0, 0, 0)),
                       dot(hash(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), f.x),
                   mix(dot(hash(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)),
                       dot(hash(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), f.x), f.y),
               mix(mix(dot(hash(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)),
                       dot(hash(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), f.x),
                   mix(dot(hash(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)),
                       dot(hash(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	vec3 world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;

    // Add noise-based displacement
    float displacement = noise(world_position * frequency + vec3(TIME * speed));
    displacement *= intensity;

    // Adjust vertex position along its normal
    VERTEX += NORMAL * displacement;

	VERTEX = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;

	float z_orig = VERTEX.z;
	float i = (1.0 - jitter) * min(VIEWPORT_SIZE.x, VIEWPORT_SIZE.y) / 2.0;

	if (jitter_depth_independent) {
		float w = (PROJECTION_MATRIX * vec4(VERTEX, 1.0)).w;
		VERTEX = round(VERTEX / w * i) / i * w;
	} else {
		VERTEX = round(VERTEX * i) / i;
	}

	if (!jitter_z_coordinate) {
		VERTEX.z = z_orig;
	}

	if (affine_texture_mapping) {
		UV *= VERTEX.z;
	}

}

void fragment() {
	vec2 uv = UV * uv_tiling;

	if (affine_texture_mapping) {
		uv /= VERTEX.z;
	}

	ALBEDO = texture(albedo, uv).rgb;
	// Sample the normal texture and adjust the surface normal
    vec3 normal_map = texture(normal, uv).rgb;
    normal_map = normal_map * 2.0 - 1.0; // Convert to -1 to 1 range
    NORMAL = normalize(NORMAL + normal_map * normal_strength);

	ALPHA = texture(albedo, uv).a;
	//ALPHA_SCISSOR = alpha_scissor;
	//EMISSION = texture(emission, uv).rgb;
	//SPECULAR = texture(specular, uv).r;
}